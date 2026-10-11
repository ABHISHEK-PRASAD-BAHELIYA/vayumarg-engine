import { gridDiskDistances } from 'h3-js';
import { SPREAD_K } from './config.js';
import { HttpError } from './http.js';

/**
 * Resolves a PM2.5 value for every requested H3 cell.
 *   direct   – tile exists in DynamoDB
 *   neighbor – no tile; inverse-distance-weighted (1/ring²) mean of tiles within SPREAD_K rings
 *   imputed  – nothing nearby; falls back to the mean of all resolved cells of this request
 * Throws 503 if the area has no data at all (we never invent a number).
 *
 * @returns {Promise<Map<string, {pm25:number, quality:string, updatedAt?:number, source?:string}>>}
 */
export async function resolvePm25(repo, cells, { k = SPREAD_K } = {}) {
  const requested = [...new Set(cells)];
  const direct = await repo.getCells(requested);
  const out = new Map();
  const missing = [];

  for (const cell of requested) {
    const hit = direct.get(cell);
    if (hit) {
      out.set(cell, { pm25: hit.pm25, quality: 'direct', updatedAt: hit.updatedAt, source: hit.source });
    } else {
      missing.push(cell);
    }
  }

  if (missing.length) {
    const rings = new Map(missing.map((cell) => [cell, gridDiskDistances(cell, k)]));
    const wanted = new Set();
    for (const ringList of rings.values()) {
      for (const ring of ringList) for (const n of ring) if (!direct.has(n)) wanted.add(n);
    }
    const extra = wanted.size ? await repo.getCells([...wanted]) : new Map();
    const lookup = (c) => direct.get(c) ?? extra.get(c);

    for (const [cell, ringList] of rings) {
      let num = 0;
      let den = 0;
      let updatedAt = Infinity;
      let source;
      for (let d = 1; d < ringList.length; d++) {
        const w = 1 / d ** 2;
        for (const n of ringList[d]) {
          const t = lookup(n);
          if (!t) continue;
          num += w * t.pm25;
          den += w;
          updatedAt = Math.min(updatedAt, t.updatedAt ?? Infinity);
          source = t.source;
        }
      }
      if (den > 0) {
        out.set(cell, { pm25: num / den, quality: 'neighbor', updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined, source });
      }
    }
  }

  const resolved = [...out.values()];
  if (!resolved.length) {
    throw new HttpError(
      503,
      'No air-quality tiles available for this area yet. Run the ingest function or choose a covered city.',
    );
  }
  const mean = resolved.reduce((s, r) => s + r.pm25, 0) / resolved.length;
  for (const cell of requested) {
    if (!out.has(cell)) out.set(cell, { pm25: mean, quality: 'imputed' });
  }
  return out;
}
