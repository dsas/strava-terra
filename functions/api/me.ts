import { Env, configured, getSession, json } from './_strava';

export async function GET(request: Request, context: { env: Env }) {
  const env = context.env;
  if (!configured(env)) return json({ configured: false }, 401);
  const s = await getSession(request, env);
  if (!s) return json({ configured: true }, 401);
  return json({ id: Number(s.athlete_id), firstname: s.firstname });
}
