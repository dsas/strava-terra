import { Env, OAUTH, SESSION_COOKIE, accessToken, clearCookie, getSession, json } from './_strava';

// Disconnect: revoke the app's access on Strava and forget the tokens.
export async function POST(request: Request, context: { env: Env }) {
  const env = context.env;
  const s = await getSession(request, env);
  if (s) {
    try {
      const token = await accessToken(env, s);
      await fetch(`${OAUTH}/deauthorize`, { method: 'POST', body: new URLSearchParams({ access_token: token }) });
    } catch (e) {
      console.warn('deauthorize failed', e);
    }
    await env.DB.prepare('DELETE FROM sessions WHERE athlete_id = ?').bind(s.athlete_id).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(SESSION_COOKIE) });
}
