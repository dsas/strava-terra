// Sample data for the demo: four years of rides, runs and walks around the Peak District,
// spreading out from a couple of favourite starting points, plus two holidays.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111320;

function offset([lat, lng], dxM, dyM) {
  return [lat + dyM / M_PER_DEG_LAT, lng + dxM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))];
}

// Smooth closed loop through jittered points on a circle.
function loopRoute(rand, start, km) {
  const r = (km * 1000) / (2 * Math.PI) * (0.85 + rand() * 0.3);
  const bearing = rand() * Math.PI * 2;
  const centre = offset(start, Math.cos(bearing) * r, Math.sin(bearing) * r);
  const n = 7 + Math.floor(rand() * 5);
  const ctrl = [];
  const startAngle = bearing + Math.PI;
  const dir = rand() < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = startAngle + dir * (i / n) * Math.PI * 2;
    const rr = i === 0 ? r : r * (0.6 + rand() * 0.75);
    ctrl.push(offset(centre, Math.cos(a) * rr, Math.sin(a) * rr));
  }
  ctrl[0] = start;
  return densify(catmull(ctrl, true), rand);
}

// Wiggly line along a heading (coast paths, ridges, linear walks).
function lineRoute(rand, start, km, heading, curl = 0.25) {
  const pts = [start];
  let h = heading, p = start;
  const step = 300;
  for (let d = 0; d < km * 1000; d += step) {
    h += (rand() - 0.5) * curl;
    p = offset(p, Math.cos(h) * step, Math.sin(h) * step);
    pts.push(p);
  }
  return densify(catmull(pts, false), rand);
}

function outAndBack(route) {
  return route.concat(route.slice().reverse());
}

function catmull(pts, closed) {
  const out = [];
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let t = 0; t < 1; t += 0.1) {
      const t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (closed) out.push(pts[0]);
  else out.push(pts[pts.length - 1]);
  return out;
}

// Add small, smooth wobble so routes look like paths, not geometry.
function densify(pts, rand) {
  const out = [];
  let wx = 0, wy = 0;
  for (let i = 0; i < pts.length; i++) {
    wx = wx * 0.8 + (rand() - 0.5) * 18;
    wy = wy * 0.8 + (rand() - 0.5) * 18;
    out.push(offset(pts[i], wx, wy));
  }
  return out;
}

function jitter(route, rand, m = 12) {
  return route.map((p) => offset(p, (rand() - 0.5) * m, (rand() - 0.5) * m));
}

function routeKm(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const dy = (b[0] - a[0]) * M_PER_DEG_LAT;
    const dx = (b[1] - a[1]) * M_PER_DEG_LAT * Math.cos((a[0] * Math.PI) / 180);
    d += Math.hypot(dx, dy);
  }
  return d / 1000;
}

const TRAILHEADS = {
  edale: [53.3665, -1.8161],
  castleton: [53.3436, -1.7766],
  hathersage: [53.3297, -1.6537],
  ladybower: [53.3757, -1.7090],
  bakewell: [53.2133, -1.6760],
  hayfield: [53.3793, -1.9466],
  baslow: [53.2487, -1.6235],
  tideswell: [53.2779, -1.7725],
};

export function demoActivities() {
  const rand = rng(20221);
  const acts = [];
  const start = Date.UTC(2022, 2, 5);
  const end = Date.UTC(2026, 9, 18);
  const favourites = new Map();
  let id = 1;

  const add = (date, type, name, coords) => {
    const km = routeKm(coords);
    acts.push({ id: id++, date, type, name, coords, dist: km * 1000, elev: Math.round(km * (12 + rand() * 18)) });
  };

  // Which trailheads are "unlocked" grows over time.
  const order = ['hathersage', 'castleton', 'edale', 'ladybower', 'baslow', 'bakewell', 'hayfield', 'tideswell'];

  for (let t = start; t < end; t += (2 + rand() * 8) * 86400000) {
    const progress = (t - start) / (end - start);
    const unlocked = Math.max(2, Math.ceil(progress * order.length));
    const th = order[Math.floor(Math.pow(rand(), 1.6) * unlocked)];
    const key = th + Math.floor(rand() * 3);
    const roll = rand();
    let coords, type = 'Walk', name;

    if (rand() < 0.45) {
      // A ride: bigger loops that reach well beyond the walking patches.
      const rideKey = 'ride-' + key;
      if (favourites.has(rideKey) && roll < 0.4) {
        coords = jitter(favourites.get(rideKey), rand, 20);
        name = `Regular ride from ${cap(th)}`;
      } else {
        coords = loopRoute(rand, TRAILHEADS[th], 25 + rand() * 40);
        name = `${cap(th)} ride`;
        if (!favourites.has(rideKey)) favourites.set(rideKey, coords);
      }
      add(t + 8 * 3600000, rand() < 0.25 ? 'GravelRide' : 'Ride', name, coords);
      continue;
    }
    if (favourites.has(key) && roll < 0.45) {
      coords = jitter(favourites.get(key), rand);
      name = `The usual from ${cap(th)}`;
    } else if (roll < 0.62) {
      coords = outAndBack(lineRoute(rand, TRAILHEADS[th], 3 + rand() * 5, rand() * Math.PI * 2));
      name = `Out and back from ${cap(th)}`;
      type = rand() < 0.3 ? 'Run' : 'Hike';
    } else {
      coords = loopRoute(rand, TRAILHEADS[th], 6 + rand() * 12);
      name = `${cap(th)} loop`;
      type = rand() < 0.5 ? 'Hike' : 'Walk';
      if (!favourites.has(key)) favourites.set(key, coords);
    }
    add(t + 9 * 3600000, type, name, coords);
  }

  // Holidays: a week in the Lakes, then the Cornish coast.
  holiday(Date.UTC(2023, 7, 12), [54.6006, -3.1340], 'Keswick', 6, (s) => loopRoute(rand, s, 10 + rand() * 8));
  let coast = [50.2115, -5.4800];
  holiday(Date.UTC(2024, 6, 20), coast, 'Coast path', 5, () => {
    const r = lineRoute(rand, coast, 9 + rand() * 5, Math.PI * (0.92 + rand() * 0.1), 0.35);
    coast = r[r.length - 1];
    return r;
  });

  function holiday(day, base, label, n, make) {
    for (let i = 0; i < n; i++) {
      const s = offset(base, (rand() - 0.5) * 6000, (rand() - 0.5) * 6000);
      add(day + i * 86400000 + 10 * 3600000, 'Hike', `${label} — day ${i + 1}`, make(s));
    }
  }

  return acts.sort((a, b) => a.date - b.date);
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
