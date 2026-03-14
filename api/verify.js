// ── Admin Token Verify — GET /api/admin/verify ──────────────────────
const { requireAuth } = require('./_auth');

module.exports = function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAuth(req, res)) return;
    return res.status(200).json({ ok: true });
};
