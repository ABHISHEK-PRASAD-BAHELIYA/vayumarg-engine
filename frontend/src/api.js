const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

async function request(path, init) {
  const res = await fetch(`${API}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const scoreRoutes = (payload, signal) =>
  request('/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

export const fetchAir = ({ lat, lng }, threshold, signal) =>
  request(`/air?lat=${lat}&lng=${lng}&threshold=${threshold}`, { signal });

// ---------------------------------------------------------------------------
// Candidate routes. Public OSRM demo servers are rate-limited and meant for
// light use; swap in your own OSRM / Amazon Location Service for production.
// ---------------------------------------------------------------------------
const OSRM = {
  car: 'https://router.project-osrm.org/route/v1/driving',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
};
const MAX_POINTS = 1200;

const toCoordString = (pts) => pts.map((p) => `${p.lng},${p.lat}`).join(';');
const decimate = (pts) => {
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  const out = pts.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
};

async function osrm(profile, waypoints, alternatives, signal) {
  const url = `${OSRM[profile]}/${toCoordString(waypoints)}?overview=full&geometries=geojson${alternatives ? '&alternatives=3' : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const json = await res.json();
  return (json.routes ?? []).map((r) => ({
    coordinates: decimate(r.geometry.coordinates.map(([lng, lat]) => [lat, lng])),
    distanceM: r.distance,
  }));
}

/** Perpendicular detour waypoints, so we get meaningfully different candidates even when OSRM offers no alternatives. */
function viaPoints(o, d) {
  const mid = { lat: (o.lat + d.lat) / 2, lng: (o.lng + d.lng) / 2 };
  const dy = d.lat - o.lat;
  const dx = d.lng - o.lng;
  const k = 0.22;
  return [
    { lat: mid.lat + dx * k, lng: mid.lng - dy * k },
    { lat: mid.lat - dx * k, lng: mid.lng + dy * k },
  ];
}

const signature = (r) => {
  const m = r.coordinates[Math.floor(r.coordinates.length / 2)];
  return `${Math.round(r.distanceM / 80)}|${m[0].toFixed(3)}|${m[1].toFixed(3)}`;
};

/** Illustrative bowed paths – only used if the routing service is unreachable. */
function illustrativeRoutes(o, d) {
  return [0, 0.16, -0.16].map((bow) => {
    const dy = d.lat - o.lat;
    const dx = d.lng - o.lng;
    const c = { lat: (o.lat + d.lat) / 2 + dx * bow, lng: (o.lng + d.lng) / 2 - dy * bow };
    const coordinates = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40;
      return [
        (1 - t) ** 2 * o.lat + 2 * (1 - t) * t * c.lat + t ** 2 * d.lat,
        (1 - t) ** 2 * o.lng + 2 * (1 - t) * t * c.lng + t ** 2 * d.lng,
      ];
    });
    return { coordinates, distanceM: 0 };
  });
}

export async function fetchCandidateRoutes(o, d, mode, signal) {
  const profile = mode === 'walking' ? 'foot' : 'car';
  let found = [];
  let illustrative = false;
  try {
    const settled = await Promise.allSettled([
      osrm(profile, [o, d], true, signal),
      ...viaPoints(o, d).map((v) => osrm(profile, [o, v, d], false, signal)),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    found = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  if (!found.length) {
    found = illustrativeRoutes(o, d);
    illustrative = true;
  }

  const seen = new Set();
  const unique = illustrative
    ? found
    : found.filter((r) => {
        const s = signature(r);
        return seen.has(s) ? false : (seen.add(s), true);
      });

  const routes = unique.slice(0, 4).map((r, i) => ({
    id: `r${i + 1}`,
    name: `Route ${String.fromCharCode(65 + i)}`,
    coordinates: r.coordinates,
  }));
  return { routes, illustrative };
}
