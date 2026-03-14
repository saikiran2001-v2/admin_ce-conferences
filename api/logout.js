// ── Admin Logout — POST /api/logout ─────────────────────────────────
module.exports = function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }
    return res.status(200).json({ ok: true });
};
