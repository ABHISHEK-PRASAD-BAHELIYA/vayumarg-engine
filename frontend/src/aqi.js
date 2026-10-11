// CPCB PM2.5 bands (µg/m³) – keep in sync with backend/src/lib/config.js.
export const BANDS = [
  { max: 30, label: 'Good', color: '#2e9e5b' },
  { max: 60, label: 'Satisfactory', color: '#8cc152' },
  { max: 90, label: 'Moderate', color: '#f2c230' },
  { max: 120, label: 'Poor', color: '#f08a24' },
  { max: 250, label: 'Very Poor', color: '#d9433b' },
  { max: Infinity, label: 'Severe', color: '#8b1d4a' },
];

export const bandFor = (pm25) => BANDS.find((b) => pm25 <= b.max);

export const MODES = {
  walking: { label: 'Walking', multiplier: 1.6 },
  two_wheeler: { label: 'Two-wheeler', multiplier: 1.2 },
  school_bus: { label: 'School bus', multiplier: 0.8 },
};
