import { bandFor } from '../aqi.js';

/** School-facing threshold banner. Red when the best available route still exceeds the threshold. */
export default function AlertBanner({ alert, mode }) {
  if (!alert) return null;
  const band = bandFor(alert.avgPm25);
  if (!alert.exceeded) {
    return (
      <div className="banner banner-ok" role="status">
        <strong>Within threshold.</strong> Best route averages {alert.avgPm25} µg/m³ ({band.label}), under your{' '}
        {alert.threshold} µg/m³ limit.
      </div>
    );
  }
  return (
    <div className="banner banner-alert" role="alert">
      <div className="banner-icon" aria-hidden="true">!</div>
      <div>
        <strong>Air-quality alert: threshold exceeded.</strong> Even the cleanest allowed route averages{' '}
        <b>{alert.avgPm25} µg/m³</b> PM2.5 ({band.label}; peak {alert.peakPm25}), above your{' '}
        <b>{alert.threshold} µg/m³</b> limit.
        <div className="banner-sub">
          {mode === 'school_bus'
            ? 'Suggested: notify the transport coordinator, keep bus windows closed, and move outdoor activity indoors.'
            : 'Suggested: delay the trip if possible, wear an N95 or equivalent, and avoid peak-hour corridors.'}
        </div>
      </div>
    </div>
  );
}
