import { latLngToCell } from 'h3-js';
import {
  H3_RESOLUTION,
  MODES,
  LIMITS,
  DEFAULT_ALERT_THRESHOLD,
  aqiLabel,
} from './config.js';
import { decodePolyline, pathLengthM, sampleRoute } from './geo.js';
import { resolvePm25 } from './airfield.js';
import { HttpError } from './http.js';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const validLatLng = (p) =>
  Array.isArray(p) && p.length >= 2 && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && p.every(Number.isFinite);

/** Validates + normalises the POST /score body. Throws HttpError(400) on bad input. */
export function validateScoreRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object');
  const { mode, routes } = body;
  if (!Object.hasOwn(MODES, mode)) {
    throw new HttpError(400, `mode must be one of: ${Object.keys(MODES).join(', ')}`);
  }
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > LIMITS.maxRoutes) {
    throw new HttpError(400, `routes must be an array of 1–${LIMITS.maxRoutes} items`);
  }

  const normalised = routes.map((r, i) => {
    let points;
    try {
      points = typeof r?.polyline === 'string' ? decodePolyline(r.polyline) : r?.coordinates;
    } catch {
      throw new HttpError(400, `routes[${i}].polyline is malformed`);
    }
    if (!Array.isArray(points) || points.length < 2 || points.length > LIMITS.maxPointsPerRoute) {
      throw new HttpError(400, `routes[${i}] needs 2–${LIMITS.maxPointsPerRoute} points (polyline or coordinates [[lat,lng],...])`);
    }
    if (!points.every(validLatLng)) throw new HttpError(400, `routes[${i}] contains an invalid [lat, lng] point`);
    if (r.durationSeconds != null && !(r.durationSeconds > 0 && r.durationSeconds < 24 * 3600)) {
      throw new HttpError(400, `routes[${i}].durationSeconds must be between 0 and 86400`);
    }
    return {
      id: String(r.id ?? `route-${i + 1}`).slice(0, 40),
      name: String(r.name ?? `Route ${i + 1}`).slice(0, 80),
      points: points.map(([lat, lng]) => [lat, lng]),
      durationSeconds: r.durationSeconds ?? null,
    };
  });

  const threshold = body.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;
  if (!(threshold > 0 && threshold <= 500)) throw new HttpError(400, 'alertThreshold must be in (0, 500]');
  const detour = body.maxDetourMinutes ?? null;
  if (detour != null && !(detour >= 0 && detour <= 180)) throw new HttpError(400, 'maxDetourMinutes must be in [0, 180]');

  return { mode, routes: normalised, alertThreshold: threshold, maxDetourMinutes: detour };
}

/** Maps a route to H3 cells and time slices. Pure – no I/O. */
export function prepareRoute(route, mode) {
  const { speedKmh } = MODES[mode];
  const distanceM = pathLengthM(route.points);
  if (distanceM < 1) throw new HttpError(400, `Route "${route.id}" has zero length`);
  if (distanceM / 1000 > LIMITS.maxRouteKm) throw new HttpError(400, `Route "${route.id}" exceeds ${LIMITS.maxRouteKm} km`);
  const durationSeconds = route.durationSeconds ?? (distanceM / 1000 / speedKmh) * 3600;
  const samples = sampleRoute(route.points).map((s) => ({
    ...s,
    cell: latLngToCell(s.lat, s.lng, H3_RESOLUTION),
  }));
  return { ...route, distanceM, durationSeconds, samples };
}

/**
 * Cumulative Inhaled Dosage = Σ ( PM2.5 × Δt_hours × VentilationMultiplier )
 * where each sample's Δt is its share of the route's total duration.
 * Units: µg·h/m³ (ventilation-weighted, i.e. a relative dose index, not absolute mass inhaled).
 */
export function scorePrepared(prepared, field, multiplier) {
  const durationHours = prepared.durationSeconds / 3600;
  let dosage = 0;
  let pmTime = 0; // Σ pm × Δt, for the time-weighted mean
  let peak = 0;
  const quality = { direct: 0, neighbor: 0, imputed: 0 };
  const perCell = new Map();

  for (const s of prepared.samples) {
    const tile = field.get(s.cell);
    const dtHours = durationHours * (s.distM / prepared.distanceM);
    dosage += tile.pm25 * dtHours * multiplier;
    pmTime += tile.pm25 * dtHours;
    peak = Math.max(peak, tile.pm25);
    quality[tile.quality] += s.distM / prepared.distanceM;
    const agg = perCell.get(s.cell) ?? { cell: s.cell, pm25: tile.pm25, quality: tile.quality, minutes: 0 };
    agg.minutes += dtHours * 60;
    perCell.set(s.cell, agg);
  }

  const avgPm25 = pmTime / durationHours;
  return {
    id: prepared.id,
    name: prepared.name,
    distanceKm: round(prepared.distanceM / 1000),
    durationMin: round(durationHours * 60, 1),
    dosage: round(dosage, 3),
    avgPm25: round(avgPm25, 1),
    peakPm25: round(peak, 1),
    aqiCategory: aqiLabel(avgPm25),
    coverage: {
      direct: round(quality.direct, 3),
      neighbor: round(quality.neighbor, 3),
      imputed: round(quality.imputed, 3),
    },
    cells: [...perCell.values()].map((c) => ({ ...c, pm25: round(c.pm25, 1), minutes: round(c.minutes, 2) })),
  };
}

/** Full pipeline: validate → H3 map → resolve PM2.5 → dosage → recommendation. */
export async function scoreRoutes(body, repo, nowMs = Date.now()) {
  const req = validateScoreRequest(body);
  const { multiplier } = MODES[req.mode];
  const prepared = req.routes.map((r) => prepareRoute(r, req.mode));
  const field = await resolvePm25(repo, prepared.flatMap((p) => p.samples.map((s) => s.cell)));
  const scored = prepared.map((p) => scorePrepared(p, field, multiplier));

  const fastest = scored.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
  const cleanest = scored.reduce((a, b) => (b.dosage < a.dosage ? b : a));
  const eligible = scored.filter(
    (r) => req.maxDetourMinutes == null || r.durationMin <= fastest.durationMin + req.maxDetourMinutes,
  );
  // Lowest dosage wins; ties go to the faster route.
  const recommended = eligible.reduce((a, b) =>
    b.dosage < a.dosage || (b.dosage === a.dosage && b.durationMin < a.durationMin) ? b : a,
  );

  for (const r of scored) {
    r.vsFastest = {
      extraMinutes: round(r.durationMin - fastest.durationMin, 1),
      dosageChangePct: round(((r.dosage - fastest.dosage) / fastest.dosage) * 100, 1),
    };
  }

  const exceeded = recommended.avgPm25 > req.alertThreshold;
  const tiles = [...field.values()];
  const sources = [...new Set(tiles.map((t) => t.source).filter(Boolean))];
  const stamps = tiles.map((t) => t.updatedAt).filter(Boolean);

  return {
    mode: req.mode,
    ventilationMultiplier: multiplier,
    formula: 'Dosage = Σ(PM2.5 × Δt_hours × VentilationMultiplier)',
    unit: 'µg·h/m³ (ventilation-weighted)',
    routes: scored,
    recommendedId: recommended.id,
    fastestId: fastest.id,
    cleanestId: cleanest.id,
    alert: {
      threshold: req.alertThreshold,
      exceeded,
      level: aqiLabel(recommended.avgPm25),
      avgPm25: recommended.avgPm25,
      peakPm25: recommended.peakPm25,
      message: exceeded
        ? `Average PM2.5 on the best route (${recommended.avgPm25} µg/m³) exceeds the ${req.alertThreshold} µg/m³ threshold.`
        : `Best route stays within the ${req.alertThreshold} µg/m³ threshold.`,
    },
    data: {
      sources,
      oldestTileAgeMin: stamps.length ? Math.round((nowMs / 1000 - Math.min(...stamps)) / 60) : null,
    },
    generatedAt: new Date(nowMs).toISOString(),
  };
}
