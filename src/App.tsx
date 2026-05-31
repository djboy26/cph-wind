// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection } from "geojson";
import { useCurrentWind } from "./hooks/useCurrentWind";
import { magnitudeColor } from "./layers/colorMap";
import { canyonModifiedWind } from "./math";
import WindCard from "./components/WindCard";
import Legend from "./components/Legend";

interface Segment {
  wayId: string | number | undefined;
  lon: number;
  lat: number;
  bearingDeg: number;
  canyonH: number;
  canyonW: number;
}

interface SegmentWithWind extends Segment {
  modifiedSpeedMs: number;
  travelDeg: number;
  color: [number, number, number, number];
}

const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };

const INITIAL_VIEW_STATE = {
  longitude: COPENHAGEN.lon,
  latitude: COPENHAGEN.lat,
  zoom: 12,
  pitch: 45,
  bearing: 0,
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export default function App() {
  const { data: windResult, loading: windLoading, error: windError } = useCurrentWind(
    COPENHAGEN.lat,
    COPENHAGEN.lon,
  );

  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [dataError, setDataError] = useState<Error | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/cph-roads.json").then((r) => {
        if (!r.ok) throw new Error(`Roads ${r.status}`);
        return r.json();
      }),
      fetch("/data/cph-segments.json").then((r) => {
        if (!r.ok) throw new Error(`Segments ${r.status}`);
        return r.json();
      }),
    ])
      .then(([r, s]) => {
        setRoads(r);
        setSegments(s);
      })
      .catch(setDataError);
  }, []);

  const segmentsWithWind = useMemo<SegmentWithWind[]>(() => {
    if (!segments || !windResult) return [];
    return segments.map((s) => {
      const cw = canyonModifiedWind(
        s.bearingDeg,
        { heightM: s.canyonH, widthM: s.canyonW },
        windResult.wind,
      );
      const travelDeg = (cw.directionDeg + 180) % 360;
      const [r, g, b] = magnitudeColor(cw.speedMs);
      return {
        ...s,
        modifiedSpeedMs: cw.speedMs,
        travelDeg,
        color: [r, g, b, 255],
      };
    });
  }, [segments, windResult]);

  const layers = useMemo(() => {
    if (!roads) return [];

    const result: any[] = [
      new GeoJsonLayer({
        id: "roads-baseline",
        data: roads,
        lineWidthMinPixels: 1,
        getLineColor: [120, 120, 120],
        getLineWidth: 1,
        pickable: false,
      }),
    ];

    if (segmentsWithWind.length > 0) {
      result.push(
        new IconLayer<SegmentWithWind>({
          id: "wind-arrows",
          data: segmentsWithWind,
          getIcon: () => "arrow",
          iconAtlas: "/arrow.svg",
          iconMapping: {
            arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true },
          },
          sizeUnits: "meters",
          getSize: 40,
          sizeMinPixels: 14,
          sizeMaxPixels: 50,
          getPosition: (d) => [d.lon, d.lat],
          getAngle: (d) => 90 - d.travelDeg,
          getColor: (d) => d.color,
          pickable: false,
          billboard: false,
        }),
      );
    }
    return result;
  }, [roads, segmentsWithWind]);

  const stillLoading = !roads || !segments;
  const showWindError = windError && !windResult; // suppress transient refresh errors if we have data
  const showDataError = dataError && stillLoading;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DeckGL initialViewState={INITIAL_VIEW_STATE} controller={true} layers={layers}>
        <Map reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>

      {/* Top-right: live wind card */}
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        {showDataError && (
          <div style={{ background: "white", color: "#c00", padding: "8px 12px", borderRadius: 6 }}>
            Data error: {dataError!.message}
          </div>
        )}
        {showWindError && (
          <div style={{ background: "white", color: "#c00", padding: "8px 12px", borderRadius: 6 }}>
            Wind error: {windError!.message}
          </div>
        )}
        {stillLoading && !dataError && (
          <div style={{ background: "white", color: "#444", padding: "8px 12px", borderRadius: 6, fontFamily: "system-ui" }}>
            Loading streets…
          </div>
        )}
        {windLoading && !windResult && !stillLoading && (
          <div style={{ background: "white", color: "#444", padding: "8px 12px", borderRadius: 6, fontFamily: "system-ui" }}>
            Loading wind…
          </div>
        )}
        {windResult && !stillLoading && (
          <WindCard
            wind={windResult.wind}
            timestamp={windResult.timestamp}
            segmentCount={segmentsWithWind.length}
          />
        )}
      </div>

      {/* Bottom-right: legend */}
      {windResult && !stillLoading && (
        <div style={{ position: "absolute", bottom: 16, right: 16 }}>
          <Legend />
        </div>
      )}
    </div>
  );
}