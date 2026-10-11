const W = 440;
const H = 260;
const PAD = { l: 52, r: 16, t: 14, b: 40 };

const niceRange = (min, max) => {
  if (min === max) return [Math.max(0, min * 0.8), max * 1.2 || 1];
  const pad = (max - min) * 0.2;
  return [Math.max(0, min - pad), max + pad];
};

/** Scatter of duration (x) vs. toxic load (y). Bottom-left is best. */
export default function TradeoffChart({ routes, recommendedId, fastestId, selectedId, onSelect }) {
  const [x0, x1] = niceRange(Math.min(...routes.map((r) => r.durationMin)), Math.max(...routes.map((r) => r.durationMin)));
  const [y0, y1] = niceRange(Math.min(...routes.map((r) => r.dosage)), Math.max(...routes.map((r) => r.dosage)));
  const sx = (v) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (v) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const ticks = (a, b, n = 4) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route duration versus cumulative inhaled dosage">
        {ticks(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={PAD.l - 8} y={sy(t) + 4} textAnchor="end" className="tick">{t.toFixed(t < 10 ? 1 : 0)}</text>
          </g>
        ))}
        {ticks(x0, x1).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" className="tick">{t.toFixed(0)}</text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" className="axis">Trip duration (min)</text>
        <text transform={`translate(12 ${(H - PAD.b + PAD.t) / 2}) rotate(-90)`} textAnchor="middle" className="axis">
          Inhaled dose (µg·h/m³)
        </text>
        {routes.map((r, i) => {
          const isRec = r.id === recommendedId;
          const isSel = r.id === selectedId;
          return (
            <g key={r.id} className="pt" onClick={() => onSelect?.(r.id)} tabIndex={0} role="button"
               aria-label={`${r.name}: ${r.durationMin} minutes, dose ${r.dosage}`}
               onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(r.id)}>
              <circle cx={sx(r.durationMin)} cy={sy(r.dosage)} r={isSel ? 13 : 11}
                className={isRec ? 'dot dot-rec' : 'dot'} />
              <text x={sx(r.durationMin)} y={sy(r.dosage) + 4} textAnchor="middle" className={isRec ? 'dot-label dot-label-rec' : 'dot-label'}>
                {String.fromCharCode(65 + i)}
              </text>
              {r.id === fastestId && (
                <text x={sx(r.durationMin)} y={sy(r.dosage) - 17} textAnchor="middle" className="note">fastest</text>
              )}
              {isRec && (
                <text x={sx(r.durationMin)} y={sy(r.dosage) + 28} textAnchor="middle" className="note note-rec">cleanest pick</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>Lower-left is better. Each dot is a candidate route.</figcaption>
    </figure>
  );
}
