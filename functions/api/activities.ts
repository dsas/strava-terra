import { Env, accessToken, apiBase, getSession, json } from './_strava';

// Proxies one page of the athlete's activity list. The list already includes a
// summary polyline per activity, so a full history needs only a handful of calls.
// Only fields the map needs are returned to the browser.
export async function GET(request: Request, context: { env: Env }) {
  const env = context.env;
  const s = await getSession(request, env);
  if (!s) return json({ error: 'not_connected' }, 401);

  const url = new URL(request.url);
  const page = Math.max(1, Math.min(500, parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);

  let token: string;
  try {
    token = await accessToken(env, s);
  } catch {
    return json({ error: 'reconnect' }, 401);
  }

  const q = new URL(`${apiBase(env)}/athlete/activities`);
  q.searchParams.set('per_page', '200');
  q.searchParams.set('page', String(page));
  if (after) q.searchParams.set('after', String(after));

  const r = await fetch(q.toString(), { headers: { authorization: `Bearer ${token}` } });
  const passthrough: Record<string, string> = {};
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-usage', 'x-readratelimit-limit', 'x-readratelimit-usage']) {
    const v = r.headers.get(h);
    if (v) passthrough[h] = v;
  }
  if (r.status === 429) return json({ error: 'rate_limited' }, 429, passthrough);
  if (r.status === 401) return json({ error: 'reconnect' }, 401);
  if (!r.ok) return json({ error: 'strava_error', status: r.status }, 502, passthrough);

  const list = (await r.json()) as any[];
  const slim = list.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    sport_type: a.sport_type,
    start_date: a.start_date,
    distance: a.distance,
    total_elevation_gain: a.total_elevation_gain,
    map: { summary_polyline: a.map?.summary_polyline || null },
  }));
  return json(slim, 200, passthrough);
}
