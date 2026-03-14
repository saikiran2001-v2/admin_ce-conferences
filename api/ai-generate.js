// ── AI Event Generator — /api/ai-generate ───────────────────────────
// Uses Gemini to generate structured event details from a title/topic.
const { requireAuth } = require('./_auth');

const DEFAULT_MODEL = 'gemini-2.0-flash';

module.exports = async function handler(req, res) {
    if (!requireAuth(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on this server.' });
    }

    const { title, topic } = req.body || {};
    const prompt = String(title || topic || '').trim().slice(0, 300);
    if (!prompt) {
        return res.status(400).json({ error: 'Provide a title or topic to generate from.' });
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const systemPrompt = `You are an expert conference content writer for CE-Conferences, a professional academic and industry conference organiser.
Given a conference description, title, or topic, generate compelling structured conference details.

CRITICAL RULES — read carefully:
- If the user mentions a specific month/year (e.g. "Sept 2027", "March 2028"), you MUST use EXACTLY that month and year in "schedule". Do NOT change it.
- If the user mentions a number of days (e.g. "3 days", "2-day"), you MUST use EXACTLY that number in "days" as a plain integer string. Do NOT change it.
- If the user mentions a specific city or country, use EXACTLY that location.
- Only invent location, schedule, or days if the user did NOT mention them.

Always return ONLY a valid JSON object with these exact fields (no markdown, no code fences, no extra text):
{
  "fullTitle": "Full descriptive conference name (e.g. International Conference on …)",
  "description": "3-4 paragraph professional conference description covering topics, audience, and value (plain text, no HTML, max 1200 chars)",
  "location": "Host city and country (e.g. Dubai, UAE)",
  "schedule": "Month and year exactly as given or sensibly suggested (e.g. Sep 2027)",
  "days": "Duration as a plain number only (e.g. 3)"
}`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: `Conference description / topic:\n${prompt}` }] }],
                    generationConfig: { temperature: 0.4, topP: 0.9, maxOutputTokens: 1200 }
                })
            }
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const msg = payload?.error?.message || 'Gemini API error';
            return res.status(response.status).json({ error: msg });
        }

        const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Strip possible markdown code fences
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            return res.status(500).json({ error: 'AI returned invalid JSON. Try again.', raw });
        }

        return res.status(200).json({
            fullTitle: String(parsed.fullTitle || '').slice(0, 200).trim(),
            description: String(parsed.description || '').slice(0, 1500).trim(),
            location: String(parsed.location || '').slice(0, 100).trim(),
            schedule: String(parsed.schedule || '').slice(0, 100).trim(),
            days: String(parsed.days || '').slice(0, 10).trim()
        });
    } catch (err) {
        return res.status(500).json({ error: err?.message || 'AI generation failed' });
    }
};
