import { gridDiskDistances, latLngToCell } from 'h3-js';
import { CITIES, H3_RESOLUTION, SPREAD_K, TILE_TTL_SECONDS } from './config.js';
import { syntheticStations } from './synthetic.js';

const OPENAQ = 'https://api.openaq.org/v3';
const PM25_PARAMETER_ID = 2;
const MAX_LOCATIONS_PER_CITY = 40;
const MAX_READING_AGE_MS = 6 * 3600 * 1000;

/** Fetches latest PM2.5 readings around a city from OpenAQ v3 (CPCB stations are included). */
export async function fetchOpenAqReadings(city, apiKey, fetchImpl = fetch, nowMs = Date.now()) {
  const headers = { 'X-API-Key': apiKey, accept: 'application/json' };
  const get = async (path) => {
    const res = await fetchImpl(`${OPENAQ}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`OpenAQ ${res.status} for ${path}`);
    return res.json();
  };

  const locs = await get(
    `/locations?coordinates=${city.lat},${city.lng}&radius=25000&parameters_id=${PM25_PARAMETER_ID}&limit=${MAX_LOCATIONS_PER_CITY}`,
  );
  const readings = [];
  const BATCH = 5; // stay polite with rate limits
  const results = locs.results ?? [];
  for (let i = 0; i < results.length; i += BATCH) {
    await Promise.all(
      results.slice(i, i + BATCH).map(async (loc) => {
        const pmSensors = new Set(
          (loc.sensors ?? []).filter((s) => s.parameter?.id === PM25_PARAMETER_ID).map((s) => s.id),
        );
        if (!loc.coordinates || !pmSensors.size) return;
        try {
          const latest = await get(`/locations/${loc.id}/latest`);
          for (const m of latest.results ?? []) {
            const observedAt = Date.parse(m.datetime?.utc ?? '');
            if (!pmSensors.has(m.sensorsId) || !Number.isFinite(m.value)) continue;
            if (!(nowMs - observedAt < MAX_READING_AGE_MS)) continue; // stale or unparsable
            readings.push({ lat: loc.coordinates.latitude, lng: loc.coordinates.longitude, value: m.value, observedAt });
          }
        } catch (err) {
          console.warn(`Skipping location ${loc.id}: ${err.message}`);
        }
      }),
    );
  }
  return readings;
}

/**
 * Spreads sparse station readings onto H3 cells with inverse-distance weights
 * (1 / (1 + ring)²) over SPREAD_K rings, merging overlaps into a weighted mean.
 * Readings outside (0, 1000] µg/m³ are treated as sensor faults and dropped.
 */
export function spreadToCells(readings, k = SPREAD_K) {
  const acc = new Map(); // cell -> {num, den, n}
  for (const r of readings) {
    if (!(r.value > 0 && r.value <= 1000)) continue;
    const rings = gridDiskDistances(latLngToCell(r.lat, r.lng, H3_RESOLUTION), k);
    rings.forEach((ring, d) => {
      const w = 1 / (1 + d) ** 2;
      for (const cell of ring) {
        const a = acc.get(cell) ?? { num: 0, den: 0, n: 0 };
        a.num += w * r.value;
        a.den += w;
        a.n += d === 0 ? 1 : 0;
        acc.set(cell, a);
      }
    });
  }
  return acc;
}

/** One ingest cycle: fetch → spread to H3 → batch write with TTL. */
export async function runIngest({ repo, env = process.env, nowMs = Date.now(), fetchImpl = fetch }) {
  const keys = (env.CITIES ?? 'delhi,mumbai,bengaluru').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const apiKey = env.OPENAQ_API_KEY || '';
  const source = apiKey ? 'openaq' : 'synthetic';
  const nowSec = Math.floor(nowMs / 1000);
  const summary = { source, cities: {}, cellsWritten: 0 };

  for (const key of keys) {
    const city = CITIES[key];
    if (!city) {
      console.warn(`Unknown city "${key}", skipping`);
      continue;
    }
    try {
      const readings = apiKey
        ? await fetchOpenAqReadings(city, apiKey, fetchImpl, nowMs)
        : syntheticStations(city, nowMs);
      const cells = spreadToCells(readings);
      const items = [...cells].map(([cell, a]) => ({
        cell,
        pm25: Math.round((a.num / a.den) * 10) / 10,
        n: a.n,
        source,
        updatedAt: nowSec,
        ttl: nowSec + TILE_TTL_SECONDS,
      }));
      await repo.putCells(items);
      summary.cities[key] = { stations: readings.length, cells: items.length };
      summary.cellsWritten += items.length;
    } catch (err) {
      console.error(`Ingest failed for ${key}: ${err.message}`);
      summary.cities[key] = { error: err.message };
    }
  }
  return summary;
}
