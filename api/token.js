/**
 * Mints a short-lived AssemblyAI token for the browser.
 *
 * A browser cannot set an Authorization header on a WebSocket, so it cannot
 * carry the permanent API key even if we wanted it to. AssemblyAI's answer is a
 * one-time token minted server-side, which is what this does.
 *
 * The permanent key never leaves the server. That matters more than usual here:
 * this page is a public demo, and a key in client JavaScript is a key that is
 * gone within the hour.
 */

/**
 * Per-instance, per-minute cap. Not a real rate limiter: serverless instances
 * come and go, so this is a ceiling on how fast any one of them can mint, not a
 * global guarantee. It is enough to stop a loop draining a hackathon credit
 * balance, which is the actual threat here.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function overLimit(ip) {
  const now = Date.now();
  const fresh = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  fresh.push(now);
  hits.set(ip, fresh);
  if (hits.size > 500) hits.clear();   // crude bound; this is a demo, not a fleet
  return fresh.length > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  const key = process.env.ASSEMBLYAI_API_KEY;

  // Tokens are only for this page's own browser calls. Anything without our
  // origin is a script, and a script that can mint tokens can open unlimited
  // voice sessions billed to this key. Origin is set by the browser and cannot
  // be forged from page JavaScript, which is the case that matters.
  const allowed = [
    'https://heat-warning-agent.vercel.app',
    'http://localhost:3000',
  ];
  const origin = req.headers.origin ?? '';
  const referer = req.headers.referer ?? '';
  const fromUs =
    allowed.includes(origin) ||
    allowed.some((a) => referer.startsWith(a + '/')) ||
    /^https:\/\/heat-warning-agent-[a-z0-9-]+\.vercel\.app$/.test(origin);

  if (!fromUs) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Tokens are only issued to the demo page.',
    });
  }

  const ip =
    (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  if (overLimit(ip)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Too many calls started from this address. Wait a minute.',
    });
  }

  if (!key) {
    return res.status(503).json({
      error: 'no_key',
      message:
        'ASSEMBLYAI_API_KEY is not set on this deployment, so live voice is off. ' +
        'The scripted walkthrough below still runs.',
    });
  }

  try {
    // agents.assemblyai.com, not api.assemblyai.com, and a Bearer prefix. The
    // first deploy guessed both and got a 502 with "Not found" from upstream.
    // expires_in_seconds must be 1-600, and tokens are single use, so a fresh
    // one is minted per call rather than cached.
    const r = await fetch('https://agents.assemblyai.com/v1/token?expires_in_seconds=600', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: 'upstream', message: body.slice(0, 300) });
    }
    const data = await r.json();
    return res.status(200).json({ token: data.token ?? data });
  } catch (err) {
    return res.status(502).json({ error: 'unreachable', message: String(err.message) });
  }
}
