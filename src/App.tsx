// src/App.tsx
import { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { FeatureCollection } from 'geojson';
import { useCurrentWind } from './hooks/useCurrentWind';
import { computeArrows, type ArrowDatum } from './layers/computeArrows';
import { magnitudeColor } from './layers/colorMap';
import { alongStreetWind } from './math';

const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };

const INITIAL_VIEW_STATE = {
  longitude: COPENHAGEN.lon,
  latitude: COPENHAGEN.lat,
  zoom: 12,
  pitch: 45,
  bearing: 0,
};

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export default function App() {
  const {
    data: windResult,
    loading: windLoading,
    error: windError,
  } = useCurrentWind(COPENHAGEN.lat, COPENHAGEN.lon);

  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [roadsError, setRoadsError] = useState<Error | null>(null);

  useEffect(() => {
    fetch('/data/cph-roads.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load roads: ${r.status}`);
        return r.json();
      })
      .then(setRoads)
      .catch(setRoadsError);
  }, []);

  const arrows = useMemo(() => (roads ? computeArrows(roads) : []), [roads]);

  const layers = useMemo(() => {
    if (!roads) return [];

    const result: any[] = [
      new GeoJsonLayer({
        id: 'roads-baseline',
        data: roads,
        lineWidthMinPixels: 1,
        getLineColor: [180, 180, 180],
        getLineWidth: 1,
        pickable: false,
      }),
    ];

    if (arrows.length > 0 && windResult) {
      const wind = windResult.wind;

      result.push(
  new TextLayer<ArrowDatum>({
    id: 'wind-arrows',
    data: arrows,
    getPosition: (d) => [d.lon, d.lat],
    getText: () => '➤',
    sizeUnits: 'meters',
    getSize: 45,
    sizeMinPixels: 14,
    sizeMaxPixels: 50,
    // All arrows point in the global wind travel direction.
    getAngle: () => 90 - ((wind.directionDeg + 180) % 360),
    // Color reflects how strongly the wind aligns with THIS street segment.
    getColor: (d) => {
      const { magnitudeMs } = alongStreetWind(d.bearingDeg, wind);
      const [r, g, b] = magnitudeColor(magnitudeMs);
      return [r, g, b, 255];
    },
    characterSet: ['➤'],
    fontFamily: 'sans-serif',
    billboard: false,
    pickable: false,
  }),
);
    }

    return result;
  }, [roads, arrows, windResult]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
      >
        <Map reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.92)',
          borderRadius: 6,
          fontFamily: 'system-ui',
          fontSize: 13,
          color: '#222',
          pointerEvents: 'none',
          maxWidth: 300,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      >
        {roadsError && <div style={{ color: '#c00' }}>Roads error: {roadsError.message}</div>}
        {windError && <div style={{ color: '#c00' }}>Wind error: {windError.message}</div>}
        {!roads && !roadsError && <div>Loading streets…</div>}
        {windLoading && !windResult && <div>Loading wind…</div>}
        {windResult && (
          <div>
            <strong>Copenhagen</strong>
            <br />
            Wind: {windResult.wind.speedMs.toFixed(1)} m/s from{' '}
            {Math.round(windResult.wind.directionDeg)}°
            {windResult.wind.gustMs !== undefined && (
              <>
                <br />
                Gusts: {windResult.wind.gustMs.toFixed(1)} m/s
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}