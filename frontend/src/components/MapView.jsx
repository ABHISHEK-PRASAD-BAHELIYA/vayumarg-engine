import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { cellToBoundary } from 'h3-js';
import { bandFor } from '../aqi.js';

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

function ClickPicker({ pickMode, onPick }) {
  useMapEvents({
    click(e) {
      if (pickMode) onPick({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) });
    },
  });
  return null;
}

export default function MapView({ candidates, result, selectedId, origin, dest, pickMode, onPick }) {
  const routes = result?.routes ?? [];
  const selected = routes.find((r) => r.id === selectedId);
  const bounds = useMemo(() => candidates.flatMap((c) => c.coordinates), [candidates]);
  const hexes = useMemo(
    () => (selected?.cells ?? []).map((c) => ({ ...c, ring: cellToBoundary(c.cell) })),
    [selected],
  );

  return (
    <MapContainer center={[origin.lat, origin.lng]} zoom={12} className={`map ${pickMode ? 'map-pick' : ''}`}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={bounds.length ? bounds : [[origin.lat, origin.lng], [dest.lat, dest.lng]]} />
      <ClickPicker pickMode={pickMode} onPick={onPick} />

      {hexes.map((h) => (
        <Polygon key={h.cell} positions={h.ring}
          pathOptions={{ color: bandFor(h.pm25).color, weight: 1, fillColor: bandFor(h.pm25).color, fillOpacity: 0.35 }}>
          <Tooltip sticky>{h.pm25} µg/m³ · {bandFor(h.pm25).label}{h.quality !== 'direct' ? ' (interpolated)' : ''}</Tooltip>
        </Polygon>
      ))}

      {candidates.map((c, i) => {
        const r = routes.find((x) => x.id === c.id);
        const isRec = r && r.id === result.recommendedId;
        const isSel = c.id === selectedId;
        return (
          <Polyline key={c.id} positions={c.coordinates}
            pathOptions={{
              color: isRec ? '#0b7a4b' : isSel ? '#1d4ed8' : '#64748b',
              weight: isRec || isSel ? 6 : 4,
              opacity: isRec || isSel ? 0.95 : 0.6,
              dashArray: r && r.id === result.fastestId && !isRec ? '8 8' : undefined,
            }}>
            <Tooltip sticky>{r ? `${String.fromCharCode(65 + i)} · ${r.durationMin} min · dose ${r.dosage}` : c.name}</Tooltip>
          </Polyline>
        );
      })}

      <CircleMarker center={[origin.lat, origin.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#0b7a4b', fillOpacity: 1 }}>
        <Tooltip permanent direction="top">Start</Tooltip>
      </CircleMarker>
      <CircleMarker center={[dest.lat, dest.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#b91c1c', fillOpacity: 1 }}>
        <Tooltip permanent direction="top">Destination</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
