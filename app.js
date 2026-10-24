import { demoActivities } from './demo.js';
import { BASEMAPS, DEFAULT_BASEMAP } from './basemaps.js';
import * as store from './store.js';

/* global maplibregl, h3 */

// ---------- Tunables ----------
const REVEAL_RADIUS_M = 60;        // half-width of the cleared path
const HEX_RES = 9;                 // ~0.1 km² cells, used only to measure explored area
const SAMPLE_STEP_M = 40;          // densify tracks before hexing
const PLAY_SECONDS = 45;           // full history at 1×
const GLOW_DAYS = 21;              // how long a new outing glows
const SKIP_TYPES = ['VirtualRide', 'VirtualRun']; // indoor trainers have no real route
const EARTH_C = 40075016.686;

// ---------- State ----------
const state = {
  all: [],              // every activity, prepared
  acts: [],             // filtered by type, sorted by date
  types: new Set(),
  enabledTypes: new Set(),
  t: 0, t0: 0, t1: 0,
  idx: -1,              // last activity index revealed at time t
  playing: false,
  speed: 1,
  showGlow: true,
  glowFade: 1,          // fades the embers out once playback reaches the end
  source: null,         // 'demo' | 'strava'
  cum: [],              // cumulative stats per activity index
};

const $ = (id) => document.getElementById(id);
const fog = $('fog');
const fctx = fog.getContext('2d');
const mask = document.createElement('canvas');
const mctx = mask.getContext('2d');
let dpr = 1;
let fogPattern = null;
const supportsFilter = 'filter' in fctx;

// ---------- Map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAPS[DEFAULT_BASEMAP].style,
  center: [-1.75, 53.33],
  zoom: 10,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  attributionControl: { compact: true },
});
map.touchZoomRotate.disableRotation();
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2f2ef' } }] };
let usedFallback = false;
let styleReady = false;
map.on('error', (e) => {
  console.warn('map:', e && e.error && e.error.message);
  // If the base map can't load at all, keep going on plain parchment.
  if (!usedFallback && !styleReady) {
    usedFallback = true;
    map.setStyle(FALLBACK_STYLE);
  }
});

let currentBase = DEFAULT_BASEMAP;
function applyBasemap(key) {
  currentBase = key;
  map.setStyle(BASEMAPS[key].style, { diff: false }); // full reload, so restyles don't leak between looks
}
map.on('style.load', () => {
  styleReady = true;
  try { BASEMAPS[currentBase].restyle?.(map); } catch (e) { console.warn(e); }
});

// ---------- Geometry prep ----------
function mercX(lng) { return (lng + 180) / 360; }
function mercY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function prepare(a) {
  const n = a.coords.length;
  const merc = new Float64Array(n * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = mercX(a.coords[i][1]), y = mercY(a.coords[i][0]);
    merc[i * 2] = x; merc[i * 2 + 1] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Cells touched, sampling roughly every SAMPLE_STEP_M.
  const cells = new Set();
  for (let i = 0; i < n; i++) {
    const p = a.coords[i];
    cells.add(h3.latLngToCell(p[0], p[1], HEX_RES));
    if (i + 1 < n) {
      const q = a.coords[i + 1];
      const d = haversine(p, q);
      const steps = Math.floor(d / SAMPLE_STEP_M);
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        cells.add(h3.latLngToCell(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, HEX_RES));
      }
    }
  }
  return { ...a, merc, bbox: [minX, minY, maxX, maxY], cells: [...cells] };
}

function rebuild() {
  state.acts = state.all.filter((a) => state.enabledTypes.has(a.type)).sort((a, b) => a.date - b.date);
  const firstSeen = new Map();
  const visits = new Map();
  let km = 0, climb = 0;
  state.cum = state.acts.map((a, i) => {
    let fresh = 0;
    for (const c of a.cells) {
      if (!firstSeen.has(c)) { firstSeen.set(c, i); fresh++; }
      visits.set(c, (visits.get(c) || 0) + 1);
    }
    km += a.dist / 1000;
    climb += a.elev || 0;
    return { cells: firstSeen.size, km, climb, fresh, freshPct: a.cells.length ? fresh / a.cells.length : 0 };
  });
  state.t0 = state.acts.length ? state.acts[0].date - 86400000 : Date.now();
  state.t1 = state.acts.length ? state.acts[state.acts.length - 1].date + 86400000 : Date.now();
  if (!state.t || state.t > state.t1 || state.t < state.t0) state.t = state.t1;

  state.cellArea = h3.getHexagonAreaAvg(HEX_RES, 'km2');
  state.idx = -2; // force refresh
  seek(state.t);
}

// ---------- Fog rendering ----------
function makeFogPattern() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1f1a15';
  g.fillRect(0, 0, 256, 256);
  // soft cloudy blotches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.03 + Math.random() * 0.05;
    grad.addColorStop(0, `rgba(120,100,78,${a})`);
    grad.addColorStop(1, 'rgba(120,100,78,0)');
    g.fillStyle = grad;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      g.save(); g.translate(dx, dy); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  return fctx.createPattern(c, 'repeat');
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  for (const c of [fog, mask]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  fog.style.width = w + 'px'; fog.style.height = h + 'px';
  fogPattern = makeFogPattern();
  draw();
}

function view() {
  const c = map.getCenter();
  const z = map.getZoom();
  const world = 512 * Math.pow(2, z);
  const w = window.innerWidth, h = window.innerHeight;
  const cx = mercX(c.lng), cy = mercY(c.lat);
  const mPerPx = (EARTH_C * Math.cos((c.lat * Math.PI) / 180)) / world;
  return { world, cx, cy, w, h, mPerPx,
    minX: cx - w / 2 / world, maxX: cx + w / 2 / world, minY: cy - h / 2 / world, maxY: cy + h / 2 / world };
}

function tracePath(ctx, a, v, upto = 1) {
  const m = a.merc;
  const n = Math.max(2, Math.floor((m.length / 2) * upto));
  ctx.moveTo((m[0] - v.cx) * v.world + v.w / 2, (m[1] - v.cy) * v.world + v.h / 2);
  for (let i = 1; i < n; i++) {
    ctx.lineTo((m[i * 2] - v.cx) * v.world + v.w / 2, (m[i * 2 + 1] - v.cy) * v.world + v.h / 2);
  }
}

function visible(a, v, padPx) {
  const pad = padPx / v.world;
  const [x0, y0, x1, y1] = a.bbox;
  return !(x1 < v.minX - pad || x0 > v.maxX + pad || y1 < v.minY - pad || y0 > v.maxY + pad);
}

let drawQueued = false;
function draw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawNow(); });
}

function drawNow() {
  const v = view();
  const W = fog.width, H = fog.height;
  const radiusPx = Math.max(REVEAL_RADIUS_M / v.mPerPx, 2.5);
  const blurPx = Math.max(radiusPx * 0.55, 2);

  // 1. Mask of everything revealed by time t (the newest outing draws progressively).
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, W, H);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.strokeStyle = '#fff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';
  mctx.lineWidth = radiusPx * 2;
  mctx.beginPath();
  for (let i = 0; i <= state.idx; i++) {
    const a = state.acts[i];
    if (!visible(a, v, radiusPx * 3)) continue;
    tracePath(mctx, a, v, progressOf(i));
  }
  mctx.stroke();

  // 2. Fog, with the mask cut out (blurred for soft edges).
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.globalCompositeOperation = 'source-over';
  fctx.filter = 'none';
  fctx.clearRect(0, 0, W, H);
  fctx.globalAlpha = 0.93;
  fctx.fillStyle = fogPattern || '#1f1a15';
  fctx.fillRect(0, 0, W, H);
  fctx.globalAlpha = 1;
  fctx.globalCompositeOperation = 'destination-out';
  if (supportsFilter) {
    fctx.filter = `blur(${blurPx * dpr}px)`;
    fctx.drawImage(mask, 0, 0);
    fctx.filter = 'none';
    fctx.drawImage(mask, 0, 0); // keep the centre of the path fully clear
  } else {
    fctx.drawImage(mask, 0, 0);
  }
  fctx.globalCompositeOperation = 'source-over';

  // 3. Embers: recent outings glow and fade.
  if (state.showGlow && state.idx >= 0 && state.glowFade > 0) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.lineCap = 'round'; fctx.lineJoin = 'round';
    const glowMs = GLOW_DAYS * 86400000;
    for (let i = state.idx; i >= 0; i--) {
      const a = state.acts[i];
      const age = state.t - a.date;
      if (age > glowMs) break;
      if (!visible(a, v, 20)) continue;
      const k = 1 - Math.max(0, age) / glowMs;
      fctx.globalAlpha = 0.85 * k * state.glowFade;
      fctx.strokeStyle = '#ffc46b';
      fctx.shadowColor = '#e8892b';
      fctx.shadowBlur = 10 * k;
      fctx.lineWidth = 1.2 + 1.8 * k;
      fctx.beginPath();
      tracePath(fctx, a, v, progressOf(i));
      fctx.stroke();
    }
    fctx.shadowBlur = 0; fctx.globalAlpha = 1;
  }
}

// While playing, the newest outing draws over a short slice of time.
function progressOf(i) {
  if (!state.playing || i !== state.idx) return 1;
  const span = (state.t1 - state.t0) / (PLAY_SECONDS * 30) * 6; // ~6 frames worth
  return Math.min(1, Math.max(0.02, (state.t - state.acts[i].date) / span));
}

map.on('move', draw);
window.addEventListener('resize', resize);

// ---------- Timeline ----------
function indexAt(t) {
  let lo = 0, hi = state.acts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (state.acts[mid].date <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function seek(t) {
  state.t = Math.min(state.t1, Math.max(state.t0, t));
  const idx = indexAt(state.t);
  const changed = idx !== state.idx;
  state.idx = idx;
  $('scrub').value = state.t1 > state.t0 ? Math.round(((state.t - state.t0) / (state.t1 - state.t0)) * 1000) : 1000;
  $('date').textContent = new Date(state.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (changed) updateStats();
  draw();
}

const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
function updateStats() {
  const c = state.cum[state.idx] || { cells: 0, km: 0, climb: 0 };
  $('s-area').textContent = `${fmt.format(c.cells * (state.cellArea || 0.105))} km²`;
  $('s-climb').textContent = `${fmt0.format(c.climb)} m`;
  $('s-count').textContent = fmt0.format(state.idx + 1);
  $('s-dist').textContent = `${fmt0.format(c.km)} km`;
  const a = state.acts[state.idx];
  const pct = a ? Math.round(c.freshPct * 100) : 0;
  $('latest-name').textContent = a ? (a.name || a.type) : '—';
  $('latest-name').title = a ? (a.name || a.type) : '';
  $('latest-meta').textContent = a ? `${fmt0.format(a.dist / 1000)} km · ${pct}% new` : ' ';
  $('newground-bar').style.width = pct + '%';
}

let lastFrame = 0;
function tick(ts) {
  if (!state.playing) return;
  const dt = lastFrame ? Math.min(0.1, (ts - lastFrame) / 1000) : 0;
  lastFrame = ts;
  const rate = (state.t1 - state.t0) / PLAY_SECONDS * state.speed;
  const next = state.t + rate * dt;
  if (next >= state.t1) { seek(state.t1); setPlaying(false); fadeGlow(); return; }
  seek(next);
  requestAnimationFrame(tick);
}

// After playback ends, let the embers linger a moment, then fade them out.
let fadeToken = 0;
function fadeGlow(delay = 1500, duration = 2500) {
  const token = ++fadeToken;
  const start = performance.now() + delay;
  const step = (now) => {
    if (token !== fadeToken) return;
    state.glowFade = Math.max(0, Math.min(1, 1 - (now - start) / duration));
    draw();
    if (state.glowFade > 0) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function resetGlow() {
  fadeToken++;
  state.glowFade = 1;
}

function setPlaying(p) {
  state.playing = p;
  if (p) resetGlow();
  $('play').textContent = p ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  if (p) {
    if (state.t >= state.t1 - 1) seek(state.t0);
    lastFrame = 0;
    requestAnimationFrame(tick);
  } else {
    draw();
  }
}

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('scrub').addEventListener('input', (e) => {
  setPlaying(false);
  resetGlow();
  seek(state.t0 + (e.target.value / 1000) * (state.t1 - state.t0));
});
document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.speed button').forEach((x) => x.classList.toggle('on', x === b));
  state.speed = Number(b.dataset.speed);
}));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
});

// ---------- Settings ----------
$('explored-info').addEventListener('click', (e) => {
  const note = $('explored-note');
  note.hidden = !note.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!note.hidden));
});
$('opt-glow').addEventListener('change', (e) => { state.showGlow = e.target.checked; draw(); });
for (const [key, b] of Object.entries(BASEMAPS)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = b.label;
  $('opt-base').appendChild(o);
}
$('opt-base').value = DEFAULT_BASEMAP;
$('opt-base').addEventListener('change', (e) => applyBasemap(e.target.value));

function renderTypes() {
  const box = $('types');
  box.innerHTML = '';
  for (const t of [...state.types].sort()) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.enabledTypes.has(t) ? ' on' : '');
    b.textContent = t.replace(/([a-z])([A-Z])/g, '$1 $2');
    b.addEventListener('click', () => {
      if (state.enabledTypes.has(t)) state.enabledTypes.delete(t); else state.enabledTypes.add(t);
      renderTypes();
      rebuild();
    });
    box.appendChild(b);
  }
}

// ---------- Loading data ----------
function load(raw, source) {
  state.source = source;
  state.all = raw.filter((a) => a.coords && a.coords.length > 1).map(prepare);
  state.types = new Set(state.all.map((a) => a.type));
  state.enabledTypes = new Set([...state.types].filter((t) => !SKIP_TYPES.includes(t)));
  renderTypes();
  state.t = 0;
  rebuild();
  fitHome();
}

// Frame the area with the most outings rather than the whole world.
function fitHome() {
  if (!state.acts.length) return;
  const counts = new Map();
  for (const a of state.acts) {
    const c = h3.latLngToCell(a.coords[0][0], a.coords[0][1], 4);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const home = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bounds = new maplibregl.LngLatBounds();
  for (const a of state.acts) {
    if (h3.latLngToCell(a.coords[0][0], a.coords[0][1], 4) !== home) continue;
    for (let i = 0; i < a.coords.length; i += 5) bounds.extend([a.coords[i][1], a.coords[i][0]]);
  }
  const narrow = window.innerWidth < 720;
  const padding = narrow ? { top: 150, bottom: 200, left: 24, right: 24 } : { top: 60, bottom: 110, left: 320, right: 280 };
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: 13 });
  draw();
}

function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  if (ms) toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Strava ----------
function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

function fromStrava(a) {
  const poly = a.map && (a.map.summary_polyline || a.map.polyline);
  return {
    id: a.id,
    date: Date.parse(a.start_date),
    type: a.sport_type || a.type,
    name: a.name,
    dist: a.distance || 0,
    elev: a.total_elevation_gain || 0,
    coords: poly ? decodePolyline(poly) : [],
  };
}

async function syncStrava(athleteId) {
  const btn = $('sync-btn');
  if (btn) btn.disabled = true;
  try {
    const existing = await store.all(athleteId);
    // Activities saved before elevation was tracked need fetching again once.
    const stale = existing.some((a) => a.elev === undefined);
    const latest = stale ? 0 : existing.reduce((m, a) => Math.max(m, a.date), 0);
    if (existing.length) load(existing, 'strava');
    let page = 1, added = 0;
    const after = latest ? Math.floor(latest / 1000) : 0;
    while (true) {
      toast(existing.length ? `Checking for new outings…` : `Fetching your activities… ${added}`, 0);
      const r = await fetch(`/api/activities?page=${page}&after=${after}`, { credentials: 'same-origin' });
      if (r.status === 429) { toast('Strava rate limit reached — try syncing again in 15 minutes.', 8000); break; }
      if (r.status === 401) { toast('Your Strava connection has expired. Please reconnect.', 8000); renderAccount(null); break; }
      if (!r.ok) { toast(`Couldn't fetch activities (${r.status}).`, 8000); break; }
      const list = await r.json();
      const mapped = list.map(fromStrava).filter((a) => a.coords.length > 1);
      await store.put(athleteId, mapped);
      added += mapped.length;
      if (list.length < 200) break;
      page++;
    }
    const all = await store.all(athleteId);
    load(all, 'strava');
    toast(added ? `Added ${added} outing${added === 1 ? '' : 's'}.` : 'Up to date.');
  } catch (e) {
    console.error(e);
    toast('Sync failed — check your connection and try again.', 8000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderAccount(me) {
  const box = $('account');
  box.innerHTML = '';
  if (me) {
    box.innerHTML = `<div class="who"><span>${escapeHtml(me.firstname || 'You')}</span></div>
      <div class="btns"><button id="sync-btn">Sync</button><button id="out-btn" class="ghost">Disconnect</button></div>`;
    $('sync-btn').addEventListener('click', () => syncStrava(me.id));
    $('out-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect from Strava and clear your map from this browser?')) return;
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
      await store.clear(me.id);
      location.reload();
    });
  } else {
    box.innerHTML = `<a class="strava-connect" href="/api/auth/start"><img src="assets/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width="237" height="48"></a>`;
    if (state.source === 'demo') box.insertAdjacentHTML('beforeend', '<div class="btns"><span class="fine">Showing sample outings</span></div>');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function boot() {
  resize();
  const params = new URLSearchParams(location.search);
  if (params.get('error')) toast(`Strava connection failed: ${params.get('error')}`, 8000);
  if (params.has('error') || params.has('connected')) history.replaceState(null, '', location.pathname);

  let me = null;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.ok) me = await r.json();
  } catch { /* offline or no functions: demo only */ }

  if (me && me.id) {
    $('welcome').hidden = true;
    renderAccount(me);
    await syncStrava(me.id);
  } else if (params.has('demo')) {
    startDemo();
  } else {
    renderAccount(null);
    $('welcome').hidden = false;
  }
}

function startDemo() {
  $('welcome').hidden = true;
  load(demoActivities(), 'demo');
  renderAccount(null);
  seek(state.t0);
  setTimeout(() => setPlaying(true), 600);
}

$('demo-btn').addEventListener('click', startDemo);

// Expose for debugging in the console.
window.terra = { state, map, seek, setPlaying };

boot();
