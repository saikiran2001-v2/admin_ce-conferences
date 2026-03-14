// ── Admin Speakers CRUD — /api/admin/speakers ───────────────────────
const { requireAuth } = require('./_auth');
const { getRedis, SPEAKERS_KEY, getSpeakers } = require('./_catalog');

function generateId() {
    return `spk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeSpeaker(body) {
    return {
        name: String(body.name || '').slice(0, 120).trim(),
        designation: String(body.designation || '').slice(0, 120).trim(),
        photo: String(body.photo || '').slice(0, 500).trim(),
        bio: String(body.bio || '').slice(0, 2000).trim()
    };
}

module.exports = async function handler(req, res) {
    if (!requireAuth(req, res)) return;

    try {
        const redis = getRedis();
        const speakers = await getSpeakers();

        if (req.method === 'GET') {
            return res.status(200).json({ speakers });
        }

        if (req.method === 'POST') {
            const data = sanitizeSpeaker(req.body || {});
            if (!data.name) return res.status(400).json({ error: 'Speaker name is required' });
            const speaker = { id: generateId(), ...data, createdAt: new Date().toISOString() };
            speakers.push(speaker);
            await redis.set(SPEAKERS_KEY, speakers);
            return res.status(201).json({ speaker });
        }

        if (req.method === 'PUT') {
            const { id } = req.body || {};
            const idx = speakers.findIndex(s => s.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Speaker not found' });
            const data = sanitizeSpeaker(req.body);
            if (!data.name) return res.status(400).json({ error: 'Speaker name is required' });
            speakers[idx] = { ...speakers[idx], ...data, updatedAt: new Date().toISOString() };
            await redis.set(SPEAKERS_KEY, speakers);
            return res.status(200).json({ speaker: speakers[idx] });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body || {};
            const filtered = speakers.filter(s => s.id !== id);
            if (filtered.length === speakers.length) return res.status(404).json({ error: 'Speaker not found' });
            await redis.set(SPEAKERS_KEY, filtered);
            return res.status(200).json({ ok: true });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/speakers error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
