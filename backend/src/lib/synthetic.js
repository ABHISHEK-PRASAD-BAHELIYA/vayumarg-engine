/**
 * Deterministic SIMULATED PM2.5 stations, used when no OPENAQ_API_KEY is configured
 * (demo / offline mode). Values are plausible, not real measurements, and tiles
 * written from them are tagged source="synthetic" so the UI can say so.
 */
const hash32 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
};

export function syntheticStations(city, nowMs) {
  const istHour = (new Date(nowMs).getUTCHours() + 5.5) % 24;
  // Two daily peaks (~09:00 and ~21:00 IST).
  const diurnal = 1 + 0.2 * Math.cos((2 * Math.PI * (istHour - 9)) / 12);
  const stations = [];
  const N = 6;
  const SPAN = 0.1; // ± degrees (~11 km)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const jitterLat = (hash32(`${city.name}:${i}:${j}:a`) - 0.5) * 0.02;
      const jitterLng = (hash32(`${city.name}:${i}:${j}:b`) - 0.5) * 0.02;
      const lat = city.lat - SPAN + (2 * SPAN * i) / (N - 1) + jitterLat;
      const lng = city.lng - SPAN + (2 * SPAN * j) / (N - 1) + jitterLng;
      // Smooth spatial field + a little per-station noise.
      const field = 0.5 + 0.5 * Math.sin(lat * 60 + 1.3) * Math.cos(lng * 55 + 0.7);
      const noise = 0.9 + 0.2 * hash32(`${city.name}:${i}:${j}:v`);
      const value = city.base * diurnal * (0.6 + 0.8 * field) * noise;
      stations.push({ lat, lng, value: Math.min(500, Math.max(5, value)), observedAt: nowMs });
    }
  }
  return stations;
}
