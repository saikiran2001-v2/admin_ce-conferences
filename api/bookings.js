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

async function resendEmail(booking) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error('RESEND_API_KEY not configured');

    const fromName = process.env.EMAIL_FROM_NAME || 'CE-Conferences';
    const fromAddr = process.env.EMAIL_FROM_ADDRESS || 'noreply@ceconferences.com';

    function esc(v) {
        return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtInr(paise) {
        return `INR ${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
    }

    const html = `
<div style="margin:0;padding:24px;background:#f6f2ff;font-family:Arial,sans-serif;color:#1b1537;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e9defa;">
    <div style="padding:28px 32px;background:linear-gradient(135deg,#120e28,#2a1d59);color:#ffffff;">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.75;">CE-CONFERENCES</div>
      <h1 style="margin:10px 0 8px;font-size:28px;">Your booking confirmation (resent)</h1>
      <p style="margin:0;opacity:.82;font-size:15px;">Here are your booking details for ${esc(booking.conference.label)}.</p>
    </div>
    <div style="padding:28px 32px;">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;">
        <div style="padding:16px;border-radius:16px;background:#f7f4ff;border:1px solid #ece4ff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b5a93;margin-bottom:6px;">Attendee</div>
          <div style="font-size:16px;font-weight:700;">${esc(booking.attendee.name)}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:#f7f4ff;border:1px solid #ece4ff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b5a93;margin-bottom:6px;">Booking Reference</div>
          <div style="font-size:16px;font-weight:700;">${esc(booking.bookingReference)}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:#f7f4ff;border:1px solid #ece4ff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b5a93;margin-bottom:6px;">Conference</div>
          <div style="font-size:16px;font-weight:700;">${esc(booking.conference.label)}</div>
          <div style="margin-top:6px;color:#5e527e;font-size:14px;">${esc(booking.conference.location)} | ${esc(booking.conference.schedule)}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:#f7f4ff;border:1px solid #ece4ff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b5a93;margin-bottom:6px;">Pass</div>
          <div style="font-size:16px;font-weight:700;">${esc(booking.ticket.label)}</div>
          <div style="margin-top:6px;color:#5e527e;font-size:14px;">${esc(String(booking.ticket.quantity))} ticket(s) | ${fmtInr(booking.ticket.totalAmount)}</div>
        </div>
      </div>
      <div style="margin-top:20px;padding:18px 20px;border-radius:16px;background:#f9fafb;border:1px solid #e5e7eb;">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:8px;">Payment</div>
        <div style="font-size:15px;line-height:1.7;">
          <strong>Payment ID:</strong> ${esc(booking.paymentId)}<br>
          <strong>Issued At:</strong> ${esc(new Date(booking.issuedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}
        </div>
      </div>
      <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5e527e;">Please keep this email and your booking reference for check-in.</p>
    </div>
  </div>
</div>`;

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: `${fromName} <${fromAddr}>`,
            to: [booking.attendee.email],
            subject: `[Resent] Your booking for ${booking.conference.label} — ${booking.bookingReference}`,
            html,
            text: [
                'CE-CONFERENCES BOOKING CONFIRMATION (RESENT)',
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

        // POST /api/bookings?action=resend — resend a pass email
        if (req.method === 'POST') {
            const { bookingReference } = req.body || {};
            if (!bookingReference) return res.status(400).json({ error: 'bookingReference required' });

            const raw = await redis.get(bookingKey('booking', bookingReference));
            if (!raw) return res.status(404).json({ error: 'Booking not found' });
            const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;

            await resendEmail(booking);
            return res.status(200).json({ ok: true, email: booking.attendee.email });
        }

        // GET /api/bookings — list all bookings
        if (req.method === 'GET') {
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
