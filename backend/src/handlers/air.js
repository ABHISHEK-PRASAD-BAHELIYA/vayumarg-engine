import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION, DEFAULT_ALERT_THRESHOLD, aqiLabel } from '../lib/config.js';
import { resolvePm25 } from '../lib/airfield.js';
import { respond, HttpError } from '../lib/http.js';
import { getRepo } from '../repo/index.js';

/** GET /air?lat=..&lng=..[&threshold=60] — current PM2.5 for the H3 cell at a point (e.g. a school gate). */
export const handler = async (event) =>
  respond(async () => {
    const q = event.queryStringParameters ?? {};
    const lat = Number(q.lat);
    const lng = Number(q.lng);
    const threshold = q.threshold == null ? DEFAULT_ALERT_THRESHOLD : Number(q.threshold);
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || q.lat == null || q.lng == null) {
      throw new HttpError(400, 'lat and lng query parameters are required');
    }
    if (!(threshold > 0 && threshold <= 500)) throw new HttpError(400, 'threshold must be in (0, 500]');

    const cell = latLngToCell(lat, lng, H3_RESOLUTION);
    const tile = (await resolvePm25(await getRepo(), [cell])).get(cell);
    return {
      cell,
      pm25: Math.round(tile.pm25 * 10) / 10,
      aqiCategory: aqiLabel(tile.pm25),
      quality: tile.quality,
      source: tile.source ?? null,
      updatedAt: tile.updatedAt ? new Date(tile.updatedAt * 1000).toISOString() : null,
      threshold,
      exceeded: tile.pm25 > threshold,
    };
  });
