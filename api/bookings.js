// ── Admin Bookings — /api/bookings ──────────────────────────────────
const { requireAuth } = require('./_auth');
const { Redis } = require('@upstash/redis');

function getRedis() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('Redis not configured');
    }
    return Redis.fromEnv();
}

function bookingKey(...parts) {
    return ['ce', ...parts].join(':');
}

async function getAllBookings(redis) {
    // Get all conference booking-sets (ce:bookings:*)
    const keys = await redis.keys('ce:bookings:*');
    if (!keys || keys.length === 0) return [];

    // Collect all booking references from every conference set
    const refArrays = await Promise.all(keys.map(k => redis.smembers(k)));
    const allRefs = [...new Set(refArrays.flat())];
    if (allRefs.length === 0) return [];

    // Fetch each booking object
    const bookings = await Promise.all(
        allRefs.map(ref => redis.get(bookingKey('booking', ref)))
    );

    return bookings
        .map(b => (typeof b === 'string' ? JSON.parse(b) : b))
        .filter(Boolean)
        .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
}

function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtInr(paise) {
    return `INR ${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
}

function buildPassHtml(booking) {
    const f = (label, value) => `
        <td style="padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.6);margin-bottom:6px;">${label}</div>
          <div style="font-size:15px;font-weight:700;color:#fff;word-break:break-word;">${value}</div>
        </td>`;

    return `
<div style="margin:0;padding:24px;background:#f4f1ff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:linear-gradient(135deg,#120e28,#2a1d59);border-radius:24px;padding:32px;color:#fff;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:0;">
      <tr>
        <td style="vertical-align:top;">
          <div style="letter-spacing:.2em;font-size:11px;text-transform:uppercase;color:rgba(255,255,255,.7);">CE-CONFERENCES</div>
          <div style="margin:8px 0 6px;font-size:26px;font-weight:700;color:#fff;">${esc(booking.conference.label)}</div>
          <div style="color:rgba(255,255,255,.78);font-size:14px;">${esc(booking.conference.location)} &middot; ${esc(booking.conference.schedule)}</div>
        </td>
        <td style="vertical-align:top;text-align:right;width:80px;">
          <div style="display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid rgba(134,239,172,.35);background:rgba(16,185,129,.18);color:#86efac;font-weight:700;font-size:12px;letter-spacing:.08em;">PAID</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="6" style="border:0;margin-top:22px;">
      <tr>${f('Attendee', esc(booking.attendee.name))}${f('Booking Ref', esc(booking.bookingReference))}</tr>
      <tr>${f('Pass Type', esc(booking.ticket.label))}${f('Tickets', esc(String(booking.ticket.quantity)))}</tr>
      <tr>${f('Total Paid', fmtInr(booking.ticket.totalAmount))}${f('Payment ID', esc(booking.paymentId))}</tr>
    </table>
    <div style="margin-top:16px;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.05);font-size:13px;color:rgba(255,255,255,.55);">
      Issued: ${esc(new Date(booking.issuedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}
    </div>
    <div style="margin-top:16px;font-size:13px;color:rgba(255,255,255,.5);line-height:1.6;">
      Please keep this pass and your booking reference for check-in.
    </div>
  </div>
</div>`;
}

async function sendEmail(booking, toEmail) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error('RESEND_API_KEY not configured');

    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) throw new Error('RESEND_FROM_EMAIL not configured');

    const html = buildPassHtml(booking);

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to: [toEmail],
            reply_to: process.env.RESEND_REPLY_TO_EMAIL || undefined,
            subject: `Your booking for ${booking.conference.label} — ${booking.bookingReference}`,
            html,
            text: [
                'CE-CONFERENCES BOOKING CONFIRMATION',
                '',
                `Booking Reference: ${booking.bookingReference}`,
                `Attendee: ${booking.attendee.name}`,
                `Conference: ${booking.conference.label}`,
                `Location: ${booking.conference.location}`,
                `Schedule: ${booking.conference.schedule}`,
                `Pass: ${booking.ticket.label}`,
                `Tickets: ${booking.ticket.quantity}`,
                `Payment ID: ${booking.paymentId}`,
            ].join('\n')
        })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Email send failed');
    return result;
}

module.exports = async function handler(req, res) {
    if (!requireAuth(req, res)) return;

    try {
        const redis = getRedis();

        // POST /api/bookings — resend/send pass email (optionally to a different address)
        if (req.method === 'POST') {
            const { bookingReference, overrideEmail } = req.body || {};
            if (!bookingReference) return res.status(400).json({ error: 'bookingReference required' });

            const raw = await redis.get(bookingKey('booking', bookingReference));
            if (!raw) return res.status(404).json({ error: 'Booking not found' });
            const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;

            // Basic email format check when sending to a different address
            const toEmail = overrideEmail
                ? overrideEmail.trim().toLowerCase()
                : booking.attendee.email;

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
                return res.status(400).json({ error: 'Invalid email address' });
            }

            await sendEmail(booking, toEmail);
            return res.status(200).json({ ok: true, email: toEmail });
        }

        // GET /api/bookings — list all bookings, or get pass HTML for a specific booking
        if (req.method === 'GET') {
            const { action, ref } = req.query || {};

            // GET /api/bookings?action=pass-html&ref=CE-XXX
            if (action === 'pass-html' && ref) {
                const raw = await redis.get(bookingKey('booking', ref));
                if (!raw) return res.status(404).json({ error: 'Booking not found' });
                const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return res.status(200).json({ html: buildPassHtml(booking), booking });
            }

            const bookings = await getAllBookings(redis);
            return res.status(200).json({ bookings, total: bookings.length });
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/bookings error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
};
