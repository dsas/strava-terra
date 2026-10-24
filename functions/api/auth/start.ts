import { Env, OAUTH, STATE_COOKIE, configured, cookie, origin, randomId, redirect } from '../_strava';

export async function GET(request: Request, context: { env: Env }) {
  const env = context.env;
  const base = origin(request, env);
  if (!configured(env)) return redirect(`${base}/?error=not_configured`);

  const state = randomId(16);
  const url = new URL(`${OAUTH}/authorize`);
  url.searchParams.set('client_id', String(env.STRAVA_CLIENT_ID));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', `${base}/api/auth/callback`);
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all');
  url.searchParams.set('state', state);
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, 600)]);
}
