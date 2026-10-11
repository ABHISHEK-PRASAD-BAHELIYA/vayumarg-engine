import { SAMPLE_STEP_M } from './config.js';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between [lat, lng] pairs. */
export function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Decodes a Google/OSRM precision-5 encoded polyline into [[lat, lng], ...]. */
export function decodePolyline(encoded, precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) throw new Error('Malformed polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

export function pathLengthM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/**
 * Splits a polyline into ≤ stepM sub-segments and returns each sub-segment's
 * midpoint plus its length. Midpoints are what we map to H3 cells, so a
 * long straight segment crossing several hexagons is attributed correctly.
 */
export function sampleRoute(points, stepM = SAMPLE_STEP_M) {
  const samples = [];
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLng] = points[i - 1];
    const [bLat, bLng] = points[i];
    const len = haversine(points[i - 1], points[i]);
    if (len === 0) continue;
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      samples.push({
        lat: aLat + (bLat - aLat) * t,
        lng: aLng + (bLng - aLng) * t,
        distM: len / n,
      });
    }
  }
  return samples;
}
