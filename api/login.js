// ── Admin Login — POST /api/admin/login ─────────────────────────────
const crypto = require('node:crypto');
const { createAdminToken } = require('./_auth');

// Constant-time string comparison (same length branch still runs full compare)
function safeStringEqual(a, b) {
    const aBuf = Buffer.from(String(a), 'utf8');
    const bBuf = Buffer.from(String(b), 'utf8');
    // Pad shorter buffer so timingSafeEqual doesn't throw on length mismatch
    const maxLen = Math.max(aBuf.length, bBuf.length);
    const aP = Buffer.concat([aBuf, Buffer.alloc(maxLen - aBuf.length)]);
    const bP = Buffer.concat([bBuf, Buffer.alloc(maxLen - bBuf.length)]);
    const equal = crypto.timingSafeEqual(aP, bP);
    return equal && aBuf.length === bBuf.length;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        return res.status(500).json({ error: 'Admin password is not configured' });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Password is required' });
    }

    if (!safeStringEqual(password, adminPassword)) {
        // Delay to slow brute-force
        await new Promise(r => setTimeout(r, 500));
        return res.status(401).json({ error: 'Invalid password' });
    }

    try {
        const token = createAdminToken();
        return res.status(200).json({ token });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
