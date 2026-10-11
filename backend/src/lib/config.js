// Central constants for VayuMarg. Pure data, no side effects.

/** H3 resolution 8 ≈ 0.74 km² cells, ~460 m edge: neighbourhood-scale air tiles. */
export const H3_RESOLUTION = 8;

/**
 * Transport modes.
 * multiplier – relative ventilation (breathing-rate) factor used in the dosage formula.
 * speedKmh   – typical urban Indian average speed, used when the client sends no duration.
 */
export const MODES = Object.freeze({
  walking: { multiplier: 1.6, speedKmh: 5 },
  two_wheeler: { multiplier: 1.2, speedKmh: 28 },
  school_bus: { multiplier: 0.8, speedKmh: 22 },
});

/** India NAAQS 24-h PM2.5 limit (µg/m³). Schools can override per request. */
export const DEFAULT_ALERT_THRESHOLD = 60;

/** CPCB National AQI PM2.5 (24-h) bands, µg/m³. */
export const AQI_BANDS = Object.freeze([
  { max: 30, label: 'Good' },
  { max: 60, label: 'Satisfactory' },
  { max: 90, label: 'Moderate' },
  { max: 120, label: 'Poor' },
  { max: 250, label: 'Very Poor' },
  { max: Infinity, label: 'Severe' },
]);

export const aqiLabel = (pm25) => AQI_BANDS.find((b) => pm25 <= b.max).label;

/** Sampling step along a route. Must be well below the H3 res-8 edge length (~460 m). */
export const SAMPLE_STEP_M = 150;

/** Neighbour radius (rings) used to spread a station reading AND to interpolate gaps at read time. */
export const SPREAD_K = 4;

/** Tiles older than this are ignored even if DynamoDB TTL has not swept them yet (TTL lag can be ~48 h). */
export const TILE_TTL_SECONDS = 8 * 3600;

export const LIMITS = Object.freeze({
  maxRoutes: 5,
  maxPointsPerRoute: 5000,
  maxRouteKm: 150,
});

/** Built-in city centres for ingestion. `base` seeds the synthetic (demo) generator only. */
export const CITIES = Object.freeze({
  delhi: { name: 'Delhi NCR', lat: 28.6139, lng: 77.209, base: 140 },
  mumbai: { name: 'Mumbai', lat: 19.076, lng: 72.8777, base: 65 },
  bengaluru: { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, base: 40 },
  kolkata: { name: 'Kolkata', lat: 22.5726, lng: 88.3639, base: 95 },
  chennai: { name: 'Chennai', lat: 13.0827, lng: 80.2707, base: 45 },
  hyderabad: { name: 'Hyderabad', lat: 17.385, lng: 78.4867, base: 55 },
  pune: { name: 'Pune', lat: 18.5204, lng: 73.8567, base: 60 },
});
