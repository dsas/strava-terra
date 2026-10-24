import { Env, ensureSchema, json } from './_strava';

// Strava webhook. Required by the API terms so we know when someone deauthorizes the app.
// GET: subscription validation handshake. POST: events.
export async function GET(request: Request, context: { env: Env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && challenge && token && token === context.env.STRAVA_VERIFY_TOKEN) {
    return json({ 'hub.challenge': challenge });
  }
  return json({ error: 'forbidden' }, 403);
}

export async function POST(request: Request, context: { env: Env }) {
  const env = context.env;
  let event: any = null;
  try { event = await request.json(); } catch { return json({ ok: true }); }

  if (event?.object_type === 'athlete' && event?.updates?.authorized === 'false' && event.owner_id) {
    await ensureSchema(env);
    await env.DB.prepare('DELETE FROM sessions WHERE athlete_id = ?').bind(Number(event.owner_id)).run();
  }
  // New activities are picked up by the browser on its next sync, so nothing else to do.
  return json({ ok: true });
}
