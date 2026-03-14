// ── Redis Catalog Helper for Admin Portal ───────────────────────────
const { Redis } = require('@upstash/redis');

const EVENTS_KEY = 'ce:admin:events';
const SPEAKERS_KEY = 'ce:admin:speakers';

function getRedis() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('Redis not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    }
    return Redis.fromEnv();
}

async function getEvents() {
    const r = getRedis();
    const raw = await r.get(EVENTS_KEY);
    return Array.isArray(raw) ? raw : [];
}

async function getSpeakers() {
    const r = getRedis();
    const raw = await r.get(SPEAKERS_KEY);
    return Array.isArray(raw) ? raw : [];
}

module.exports = { getRedis, getEvents, getSpeakers, EVENTS_KEY, SPEAKERS_KEY };
