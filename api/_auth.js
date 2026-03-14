// ── Admin JWT Auth Helper ───────────────────────────────────────────
const crypto = require('node:crypto');

const JWT_EXPIRY = 24 * 3600; // 24 hours

function getSecret() {
    const s = process.env.ADMIN_JWT_SECRET;
    if (!s || s.length < 16) throw new Error('ADMIN_JWT_SECRET not configured (min 16 chars)');
    return s;
}

function createAdminToken() {
    const secret = getSecret();
    const now = Math.floor(Date.now() / 1000);
    const payload = { role: 'admin', iat: now, exp: now + JWT_EXPIRY };
    const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const bdy = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${hdr}.${bdy}`).digest('base64url');
    return `${hdr}.${bdy}.${sig}`;
}

function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return null;
    let secret;
    try { secret = getSecret(); } catch { return null; }
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hdr, bdy, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${hdr}.${bdy}`).digest('base64url');
    try {
        if (sig.length !== expected.length) return null;
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
    } catch { return null; }
    try {
        const payload = JSON.parse(Buffer.from(bdy, 'base64url').toString('utf8'));
        if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
        if (payload.role !== 'admin') return null;
        return payload;
    } catch { return null; }
}

function requireAuth(req, res) {
    const auth = (req.headers['authorization'] || '').trim();
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
    if (!token || !verifyAdminToken(token)) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

module.exports = { createAdminToken, verifyAdminToken, requireAuth };
