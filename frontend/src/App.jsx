import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAir, fetchCandidateRoutes, scoreRoutes } from './api.js';
import { MODES, bandFor } from './aqi.js';
import { PRESETS } from './presets.js';
import AlertBanner from './components/AlertBanner.jsx';
import MapView from './components/MapView.jsx';
import RouteCards from './components/RouteCards.jsx';
import TradeoffChart from './components/TradeoffChart.jsx';

const THRESHOLDS = [
  { value: 30, label: '30 · CPCB "Good" limit' },
  { value: 60, label: '60 · India NAAQS 24 h' },
  { value: 90, label: '90 · CPCB "Moderate" limit' },
];

export default function App() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [origin, setOrigin] = useState(PRESETS[0].origin);
  const [dest, setDest] = useState(PRESETS[0].dest);
  const [mode, setMode] = useState(PRESETS[0].mode);
  const [maxDetour, setMaxDetour] = useState(15);
  const [threshold, setThreshold] = useState(60);
  const [pickMode, setPickMode] = useState(null);

  const [candidates, setCandidates] = useState([]);
  const [illustrative, setIllustrative] = useState(false);
  const [result, setResult] = useState(null);
  const [air, setAir] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    try {
      const [{ routes, illustrative: ill }, airNow] = await Promise.all([
        fetchCandidateRoutes(origin, dest, mode, ctrl.signal),
        fetchAir(origin, threshold, ctrl.signal).catch(() => null),
      ]);
      const scored = await scoreRoutes(
        {
          mode,
          alertThreshold: threshold,
          maxDetourMinutes: maxDetour,
          routes: routes.map(({ id, name, coordinates }) => ({ id, name, coordinates })),
        },
        ctrl.signal,
      );
      setCandidates(routes);
      setIllustrative(ill);
      setResult(scored);
      setAir(airNow);
      setSelectedId(scored.recommendedId);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Something went wrong');
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [origin, dest, mode, maxDetour, threshold]);

  // Initial load only; later runs are user-triggered (public routing servers are rate-limited).
  useEffect(() => {
    run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (i) => {
    const p = PRESETS[i];
    setPresetIdx(i);
    setOrigin(p.origin);
    setDest(p.dest);
    setMode(p.mode);
    setPickMode(null);
  };

  const onPick = (pt) => {
    if (pickMode === 'origin') setOrigin(pt);
    if (pickMode === 'dest') setDest(pt);
    setPickMode(null);
    setPresetIdx(-1);
  };

  const rec = result?.routes.find((r) => r.id === result.recommendedId);
  const fastest = result?.routes.find((r) => r.id === result.fastestId);
  const simulated = result?.data.sources.includes('synthetic');

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>VayuMarg <span>वायुमार्ग</span></h1>
          <p>Pick the route that lets you breathe least pollution, not just the fastest one.</p>
        </div>
        {air && (
          <div className="air" title={`H3 cell ${air.cell}`}>
            <span className="swatch" style={{ background: bandFor(air.pm25).color }} />
            <b>{air.pm25}</b> µg/m³ at start · {air.aqiCategory}
          </div>
        )}
      </header>

      {simulated && (
        <div className="notice">
          Showing <b>simulated</b> PM2.5 (no OpenAQ key configured). Routes and scores are for demonstration only.
        </div>
      )}
      <AlertBanner alert={result?.alert} mode={mode} />

      <main className="layout">
        <section className="panel" aria-label="Plan">
          <div className="field">
            <label htmlFor="preset">Commute</label>
            <select id="preset" value={presetIdx} onChange={(e) => choosePreset(Number(e.target.value))}>
              {presetIdx === -1 && <option value={-1}>Custom points</option>}
              {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
            <div className="row">
              <button type="button" className={`ghost ${pickMode === 'origin' ? 'on' : ''}`}
                onClick={() => setPickMode(pickMode === 'origin' ? null : 'origin')}>Set start on map</button>
              <button type="button" className={`ghost ${pickMode === 'dest' ? 'on' : ''}`}
                onClick={() => setPickMode(pickMode === 'dest' ? null : 'dest')}>Set destination on map</button>
            </div>
            {pickMode && <p className="hint">Click the map to place the {pickMode === 'origin' ? 'start' : 'destination'}.</p>}
          </div>

          <fieldset className="field">
            <legend>Travelling by</legend>
            <div className="seg">
              {Object.entries(MODES).map(([k, m]) => (
                <label key={k} className={mode === k ? 'seg-on' : ''}>
                  <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} />
                  {m.label}<small>×{m.multiplier}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="detour">Max extra time for a cleaner route: <b>{maxDetour} min</b></label>
            <input id="detour" type="range" min="0" max="45" step="5" value={maxDetour}
              onChange={(e) => setMaxDetour(Number(e.target.value))} />
          </div>

          <div className="field">
            <label htmlFor="thr">School alert threshold (PM2.5 µg/m³)</label>
            <select id="thr" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              {THRESHOLDS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <button type="button" className="primary" onClick={run} disabled={loading}>
            {loading ? 'Scoring routes…' : 'Compare routes'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}

          {rec && fastest && (
            <div className="reco" aria-live="polite">
              <h2>Live recommendation</h2>
              {rec.id === fastest.id ? (
                <p><b>{rec.name}</b> is both the fastest and the cleanest option here ({rec.durationMin} min, avg {rec.avgPm25} µg/m³).</p>
              ) : (
                <p>
                  Take <b>{rec.name}</b>: <b>{Math.abs(rec.vsFastest.dosageChangePct)}% less</b> toxic load than the fastest route
                  for <b>{rec.vsFastest.extraMinutes} extra min</b>.
                </p>
              )}
              {illustrative && <p className="warn">Routing service unreachable: paths shown are illustrative, not real roads.</p>}
            </div>
          )}
        </section>

        <section className="viz" aria-label="Results">
          <MapView candidates={candidates} result={result} selectedId={selectedId}
            origin={origin} dest={dest} pickMode={pickMode} onPick={onPick} />
          {result && (
            <div className="results">
              <TradeoffChart routes={result.routes} recommendedId={result.recommendedId}
                fastestId={result.fastestId} selectedId={selectedId} onSelect={setSelectedId} />
              <RouteCards routes={result.routes} recommendedId={result.recommendedId}
                fastestId={result.fastestId} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          )}
          {result && (
            <p className="foot">
              Dose = Σ(PM2.5 × Δt<sub>h</sub> × ventilation ×{result.ventilationMultiplier}) in {result.unit}. A relative index for comparing
              routes, not a medical measurement. Data: {result.data.sources.join(', ') || 'n/a'}
              {result.data.oldestTileAgeMin != null && `, oldest tile ${result.data.oldestTileAgeMin} min old`}.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
