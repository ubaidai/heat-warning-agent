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
export default async function handler(req, res) {
  const key = process.env.ASSEMBLYAI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: 'no_key',
      message:
        'ASSEMBLYAI_API_KEY is not set on this deployment, so live voice is off. ' +
        'The scripted walkthrough below still runs.',
    });
  }

  try {
    const r = await fetch('https://api.assemblyai.com/v1/token?expires_in_seconds=600', {
      headers: { Authorization: key },
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
