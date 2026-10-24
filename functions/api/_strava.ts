// Shared helpers for the Strava routes. Files starting with "_" are never routed.
//
// Environment variables (set on the Space):
//   STRAVA_CLIENT_ID      — from strava.com/settings/api
//   STRAVA_CLIENT_SECRET  — from strava.com/settings/api (secret)
//   STRAVA_VERIFY_TOKEN   — any random string; used when creating the webhook subscription
//   STRAVA_API_BASE       — optional; defaults to https://www.strava.com/api/v3
//                           (switch to https://api-v3.strava.com/... when Strava migrates)
//   PUBLIC_ORIGIN         — optional; the site's public origin if it differs from the request URL

export type Env = Record<string, any> & { DB: any };

export const OAUTH = 'https://www.strava.com/oauth';
export const SESSION_COOKIE = 'fow_sid';
export const STATE_COOKIE = 'fow_state';
const SESSION_DAYS = 180;

export function apiBase(env: Env): string {
  return (env.STRAVA_API_BASE || 'https://www.strava.com/api/v3').replace(/\/$/, '');
}

export function origin(request: Request, env: Env): string {
  if (env.PUBLIC_ORIGIN) return String(env.PUBLIC_ORIGIN).replace(/\/$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto');
  if (host) return `${proto || 'https'}://${host}`;
  return url.origin;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function randomId(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

let schemaReady = false;
export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  // The Space database is MySQL: keys need fixed-length VARCHAR, and indexes go inline.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      athlete_id BIGINT NOT NULL,
      firstname VARCHAR(255) NULL,
      access_token VARCHAR(255) NOT NULL,
      refresh_token VARCHAR(255) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX sessions_athlete (athlete_id)
    )`,
  ).run();
  schemaReady = true;
}

export type Session = {
  id: string; athlete_id: number; firstname: string | null;
  access_token: string; refresh_token: string; expires_at: number;
};

export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid) return null;
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(sid).first();
  return (row as Session) || null;
}

export async function createSession(env: Env, token: any): Promise<string> {
  await ensureSchema(env);
  const id = randomId();
  await env.DB.prepare(
    `INSERT INTO sessions (id, athlete_id, firstname, access_token, refresh_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, token.athlete.id, token.athlete.firstname || null,
    token.access_token, token.refresh_token, token.expires_at, Math.floor(Date.now() / 1000),
  ).run();
  return id;
}

export function sessionCookie(id: string): string {
  return cookie(SESSION_COOKIE, id, SESSION_DAYS * 86400);
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({
    client_id: String(env.STRAVA_CLIENT_ID),
    client_secret: String(env.STRAVA_CLIENT_SECRET),
    ...params,
  });
  const r = await fetch(`${OAUTH}/token`, { method: 'POST', body });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return r.json();
}

export function exchangeCode(env: Env, code: string) {
  return tokenRequest(env, { code, grant_type: 'authorization_code' });
}

// Returns a valid access token, refreshing (and persisting) it if it's about to expire.
export async function accessToken(env: Env, s: Session): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (Number(s.expires_at) - 300 > now) return s.access_token;
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: s.refresh_token });
  await env.DB.prepare('UPDATE sessions SET access_token = ?, refresh_token = ?, expires_at = ? WHERE athlete_id = ?')
    .bind(t.access_token, t.refresh_token, t.expires_at, s.athlete_id).run();
  return t.access_token;
}

export function configured(env: Env): boolean {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}
