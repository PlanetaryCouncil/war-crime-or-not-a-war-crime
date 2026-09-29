// Shared vote log: Cloudflare Worker + D1. Append-only; ratings are computed client-side.
// Deploy: see worker/README.md.

const MAX_BODY = 2000;
const ID = /^[a-z0-9-]{1,80}$/;

export default {
  async fetch(req, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/api/events') return new Response('not found', { status: 404, headers: cors });

    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT body FROM events ORDER BY id').all();
      return Response.json(results.map((r) => JSON.parse(r.body)), { headers: { ...cors, 'cache-control': 'max-age=30' } });
    }

    if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > MAX_BODY) return new Response('too large', { status: 413, headers: cors });
      let e;
      try { e = JSON.parse(text); } catch { return new Response('bad json', { status: 400, headers: cors }); }
      const clean = validate(e);
      if (!clean) return new Response('invalid event', { status: 400, headers: cors });
      clean.t = Date.now();
      await env.DB.prepare('INSERT INTO events (body, ip_hash) VALUES (?, ?)')
        .bind(JSON.stringify(clean), await hash(req.headers.get('cf-connecting-ip') || '', env.SALT || ''))
        .run();
      return new Response(null, { status: 204, headers: cors });
    }
    return new Response('method not allowed', { status: 405, headers: cors });
  },
};

// Only accept the two known shapes; drop anything else.
function validate(e) {
  if (!e || typeof e.pid !== 'string' || e.pid.length > 64) return null;
  if (e.type === 'vote' && ID.test(e.a) && ID.test(e.b) && [0, 0.5, 1].includes(e.outcome)) {
    return { type: 'vote', pid: e.pid, a: e.a, b: e.b, outcome: e.outcome };
  }
  if (e.type === 'rating' && ID.test(e.headline) && ['pre', 'post'].includes(e.phase) &&
      [-2, -1, 0, 1, 2].includes(e.score) && Array.isArray(e.tags) && e.tags.length <= 10) {
    return { type: 'rating', pid: e.pid, headline: e.headline, phase: e.phase, score: e.score, tags: e.tags.map(String).map((s) => s.slice(0, 60)) };
  }
  return null;
}

// Hashed IP lets you spot ballot-stuffing later without storing raw IPs.
async function hash(s, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + s));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
