import {
  Env, STATE_COOKIE, clearCookie, createSession, exchangeCode, origin, readCookie, redirect, sessionCookie,
} from '../_strava';

export async function GET(request: Request, context: { env: Env }) {
  const env = context.env;
  const base = origin(request, env);
  const url = new URL(request.url);
  const fail = (reason: string) => redirect(`${base}/?error=${encodeURIComponent(reason)}`, [clearCookie(STATE_COOKIE)]);

  if (url.searchParams.get('error')) return fail('access_denied');
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, STATE_COOKIE)) return fail('state_mismatch');

  const scope = url.searchParams.get('scope') || '';
  if (!scope.includes('activity:read')) return fail('activity_permission_needed');

  const code = url.searchParams.get('code');
  if (!code) return fail('missing_code');

  try {
    const token = await exchangeCode(env, code);
    const sid = await createSession(env, token);
    return redirect(`${base}/?connected=1`, [sessionCookie(sid), clearCookie(STATE_COOKIE)]);
  } catch (e) {
    console.error('callback', e);
    return fail('token_exchange_failed');
  }
}
