import { bandFor } from '../aqi.js';

const signed = (n, unit) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`;

export default function RouteCards({ routes, recommendedId, fastestId, selectedId, onSelect }) {
  return (
    <ul className="cards">
      {routes.map((r, i) => {
        const band = bandFor(r.avgPm25);
        const interpolated = Math.round((r.coverage.neighbor + r.coverage.imputed) * 100);
        const isRec = r.id === recommendedId;
        return (
          <li key={r.id}>
            <button type="button" className={`card ${isRec ? 'card-rec' : ''} ${r.id === selectedId ? 'card-sel' : ''}`}
              onClick={() => onSelect(r.id)}>
              <div className="card-head">
                <span className="letter">{String.fromCharCode(65 + i)}</span>
                <span className="card-name">{r.name}</span>
                {isRec && <span className="chip chip-rec">Recommended</span>}
                {r.id === fastestId && <span className="chip">Fastest</span>}
              </div>
              <dl className="stats">
                <div><dt>Time</dt><dd>{r.durationMin} min</dd></div>
                <div><dt>Distance</dt><dd>{r.distanceKm} km</dd></div>
                <div><dt>Dose</dt><dd>{r.dosage}</dd></div>
                <div>
                  <dt>Avg PM2.5</dt>
                  <dd><span className="swatch" style={{ background: band.color }} />{r.avgPm25}</dd>
                </div>
              </dl>
              {r.id !== fastestId && (
                <p className="delta">
                  vs fastest: {signed(r.vsFastest.extraMinutes, ' min')} · {signed(r.vsFastest.dosageChangePct, '%')} dose
                </p>
              )}
              {interpolated > 25 && <p className="warn">{interpolated}% of this route uses interpolated air data</p>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
