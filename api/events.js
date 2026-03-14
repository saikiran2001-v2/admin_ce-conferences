// ── Admin Events CRUD — /api/admin/events ───────────────────────────
const { requireAuth } = require('./_auth');
const { getRedis, EVENTS_KEY, getEvents } = require('./_catalog');

function generateId(title) {
    const slug = String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 36);
    return `${slug}-${Date.now().toString(36).slice(-4)}`;
}

function sanitizeTickets(tickets) {
    if (!Array.isArray(tickets)) return [];
    return tickets
        .map(t => ({
            key: String(t.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30),
            label: String(t.label || '').slice(0, 60).trim(),
            amountPaise: Math.max(0, Math.round(Number(t.amountPaise) || 0)),
            currency: 'INR'
        }))
        .filter(t => t.key && t.label);
}

function sanitizeEvent(body) {
    const gallery = Array.isArray(body.gallery)
        ? body.gallery.map(u => String(u).slice(0, 2000000).trim()).filter(Boolean).slice(0, 10)
        : [];
    return {
        title: String(body.title || '').slice(0, 100).trim(),
        fullTitle: String(body.fullTitle || body.title || '').slice(0, 200).trim(),
        location: String(body.location || '').slice(0, 100).trim(),
        schedule: String(body.schedule || '').slice(0, 100).trim(),
        startDate: String(body.startDate || '').slice(0, 20).trim(),
        days: String(body.days || '').slice(0, 20).trim(),
        image: String(body.image || '').slice(0, 2000000).trim(),
        gallery,
        description: String(body.description || '').slice(0, 2000).trim(),
        speakerIds: Array.isArray(body.speakerIds) ? body.speakerIds.map(String) : [],
        tickets: sanitizeTickets(body.tickets),
        maxBookings: Math.max(1, Math.round(Number(body.maxBookings) || 250)),
        status: ['published', 'draft'].includes(body.status) ? body.status : 'draft'
    };
}

module.exports = async function handler(req, res) {
    if (!requireAuth(req, res)) return;

    try {
        const redis = getRedis();
        const events = await getEvents();

        if (req.method === 'GET') {
            return res.status(200).json({ events });
        }

        if (req.method === 'POST') {
            const data = sanitizeEvent(req.body || {});
            if (!data.title) return res.status(400).json({ error: 'Event title is required' });
            const event = { id: generateId(data.title), ...data, createdAt: new Date().toISOString() };
            events.push(event);
            await redis.set(EVENTS_KEY, events);
            return res.status(201).json({ event });
        }

        if (req.method === 'PUT') {
            const { id } = req.body || {};
            const idx = events.findIndex(e => e.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Event not found' });
            const data = sanitizeEvent(req.body);
            if (!data.title) return res.status(400).json({ error: 'Event title is required' });
            events[idx] = { ...events[idx], ...data, updatedAt: new Date().toISOString() };
            await redis.set(EVENTS_KEY, events);
            return res.status(200).json({ event: events[idx] });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body || {};
            const filtered = events.filter(e => e.id !== id);
            if (filtered.length === events.length) return res.status(404).json({ error: 'Event not found' });
            await redis.set(EVENTS_KEY, filtered);
            return res.status(200).json({ ok: true });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/events error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
