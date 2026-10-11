import test from 'node:test';
import assert from 'node:assert/strict';
import { gridDisk, latLngToCell } from 'h3-js';
import { MemoryRepo } from '../src/repo/memory.js';
import { decodePolyline, haversine } from '../src/lib/geo.js';
import { scoreRoutes } from '../src/lib/scoring.js';
import { resolvePm25 } from '../src/lib/airfield.js';
import { runIngest, spreadToCells } from '../src/lib/ingest.js';
import { H3_RESOLUTION } from '../src/lib/config.js';

const START = [28.6139, 77.209];
// ~5 km due east of START (1° lng ≈ 98 km at this latitude)
const eastKm = (km, dLat = 0) => [START[0] + dLat, START[1] + km / 98.0];

function uniformRepo(pm25) {
  const repo = new MemoryRepo();
  for (const c of gridDisk(latLngToCell(...START, H3_RESOLUTION), 30)) repo.seed(c, pm25);
  return repo;
}

test('decodePolyline matches the canonical Google example', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(pts, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('dosage = PM2.5 × hours × multiplier (walking, uniform air)', async () => {
  const p = [START, eastKm(5)];
  const len = haversine(p[0], p[1]);
  const hours = len / 1000 / 5; // walking 5 km/h
  const res = await scoreRoutes({ mode: 'walking', routes: [{ id: 'a', coordinates: p }] }, uniformRepo(100));
  assert.ok(Math.abs(res.routes[0].dosage - 100 * hours * 1.6) < 0.05);
  assert.equal(res.routes[0].avgPm25, 100);
  assert.equal(res.ventilationMultiplier, 1.6);
});

test('ventilation multipliers: school_bus < two_wheeler < walking for the same trip & duration', async () => {
  const routes = [{ id: 'a', coordinates: [START, eastKm(4)], durationSeconds: 1800 }];
  const repo = uniformRepo(80);
  const d = {};
  for (const mode of ['walking', 'two_wheeler', 'school_bus']) d[mode] = (await scoreRoutes({ mode, routes }, repo)).routes[0].dosage;
  assert.ok(Math.abs(d.walking / d.school_bus - 2) < 0.01); // 1.6 / 0.8
  assert.ok(Math.abs(d.two_wheeler / d.school_bus - 1.5) < 0.01); // 1.2 / 0.8
});

test('recommends the cleaner route and respects maxDetourMinutes', async () => {
  const repo = new MemoryRepo();
  const north = 0.02; // detour latitude offset
  // Polluted corridor along the direct line, clean corridor to the north.
  for (const c of gridDisk(latLngToCell(...START, H3_RESOLUTION), 30)) repo.seed(c, 150);
  const cleanCells = new Set();
  for (let i = 0; i <= 40; i++) {
    const [lat, lng] = [START[0] + north, START[1] + (i / 40) * (6 / 98)];
    for (const c of gridDisk(latLngToCell(lat, lng, H3_RESOLUTION), 1)) cleanCells.add(c);
  }
  for (const c of cleanCells) repo.seed(c, 40);

  const direct = { id: 'direct', coordinates: [START, eastKm(6)] };
  const detour = { id: 'detour', coordinates: [START, [START[0] + north, START[1]], eastKm(6, north), eastKm(6)] };

  const open = await scoreRoutes({ mode: 'school_bus', routes: [direct, detour] }, repo);
  assert.equal(open.fastestId, 'direct');
  assert.equal(open.recommendedId, 'detour');
  assert.ok(open.routes[1].dosage < open.routes[0].dosage);
  assert.ok(open.routes[1].vsFastest.extraMinutes > 0);

  const capped = await scoreRoutes({ mode: 'school_bus', maxDetourMinutes: 0, routes: [direct, detour] }, repo);
  assert.equal(capped.recommendedId, 'direct');
});

test('alert fires only above the threshold', async () => {
  const routes = [{ id: 'a', coordinates: [START, eastKm(2)] }];
  const hi = await scoreRoutes({ mode: 'school_bus', routes, alertThreshold: 60 }, uniformRepo(95));
  const lo = await scoreRoutes({ mode: 'school_bus', routes, alertThreshold: 60 }, uniformRepo(25));
  assert.equal(hi.alert.exceeded, true);
  assert.equal(hi.alert.level, 'Poor');
  assert.equal(lo.alert.exceeded, false);
});

test('missing tiles are interpolated from neighbours, then imputed; empty area → 503', async () => {
  const origin = latLngToCell(...START, H3_RESOLUTION);
  const repo = new MemoryRepo();
  const [ring0, ring1] = [[origin], gridDisk(origin, 1).filter((c) => c !== origin)];
  repo.seed(ring1[0], 100);
  const field = await resolvePm25(repo, [...ring0, ...ring1]);
  assert.equal(field.get(ring1[0]).quality, 'direct');
  assert.equal(field.get(origin).quality, 'neighbor');
  assert.equal(field.get(origin).pm25, 100);

  await assert.rejects(() => resolvePm25(new MemoryRepo(), [origin]), { statusCode: 503 });
});

test('input validation returns 400s', async () => {
  const repo = uniformRepo(50);
  await assert.rejects(() => scoreRoutes({ mode: 'rocket', routes: [] }, repo), { statusCode: 400 });
  await assert.rejects(() => scoreRoutes({ mode: 'walking', routes: [{ coordinates: [[1, 1]] }] }, repo), { statusCode: 400 });
  await assert.rejects(() => scoreRoutes({ mode: 'walking', routes: [{ coordinates: [[95, 1], [1, 1]] }] }, repo), { statusCode: 400 });
});

test('ingest (synthetic) writes TTL-stamped tiles that scoring can read', async () => {
  const repo = new MemoryRepo();
  const nowMs = Date.parse('2026-10-11T10:00:00Z');
  const summary = await runIngest({ repo, env: { CITIES: 'delhi' }, nowMs });
  assert.equal(summary.source, 'synthetic');
  assert.ok(summary.cellsWritten > 500);
  const sample = [...repo.items.values()][0];
  assert.ok(sample.ttl > sample.updatedAt);
  const res = await scoreRoutes({ mode: 'walking', routes: [{ id: 'a', coordinates: [START, eastKm(3)] }] }, repo, nowMs);
  assert.ok(res.routes[0].coverage.direct > 0.9);
  assert.deepEqual(res.data.sources, ['synthetic']);
});

test('spreadToCells drops implausible sensor values', () => {
  assert.equal(spreadToCells([{ lat: 28.6, lng: 77.2, value: -4 }, { lat: 28.6, lng: 77.2, value: 5000 }]).size, 0);
});
