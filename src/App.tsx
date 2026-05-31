// src/App.tsx
import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection } from "geojson";
import { useCurrentWind } from "./hooks/useCurrentWind";
import { magnitudeColor } from "./layers/colorMap";
import { canyonModifiedWind } from "./math";
import WindCard from "./components/WindCard";
import Legend from "./components/Legend";
import SegmentTooltip from "./components/SegmentTooltip";
import About from "./components/About";

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
interface HoverState {
  x: number;
  y: number;
  segment: SegmentWithWind;
}

const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, fontFamily: "system-ui", maxWidth: 600, margin: "60px auto",
          background: "#fff5f5", border: "1px solid #f5c2c2", borderRadius: 8,
        }}>
          <h2 style={{ color: "#c00", marginTop: 0 }}>Something broke</h2>
          <p>{this.state.error.message}</p>
          <p style={{ fontSize: 13, color: "#666" }}>
            Refresh the page to retry. If it keeps happening, the data files may be missing — open the browser console for details.
          </p>
          <button
            onClick={() => location.reload()}
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #aaa", background: "white", cursor: "pointer" }}
          >Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MapApp() {
  const isMobile = useIsMobile();

  const initialViewState = useMemo(() => ({
    longitude: COPENHAGEN.lon,
    latitude: COPENHAGEN.lat,
    zoom: isMobile ? 13 : 12,
    pitch: isMobile ? 0 : 45,
    bearing: 0,
  }), [isMobile]);

  const { data: windResult, loading: windLoading, error: windError } = useCurrentWind(
    COPENHAGEN.lat, COPENHAGEN.lon,
  );

  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [dataError, setDataError] = useState<Error | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<HoverState | null>(null);

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
      .then(([r, s]) => { setRoads(r); setSegments(s); })
      .catch(setDataError);
  }, []);

  const wayNames = useMemo(() => {
    if (!roads) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const f of roads.features) {
      const p: any = f.properties || {};
      if (p.name && p.id) m.set(String(p.id), p.name);
    }
    return m;
  }, [roads]);

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
      return { ...s, modifiedSpeedMs: cw.speedMs, travelDeg, color: [r, g, b, 255] };
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
          iconMapping: { arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } },
          sizeUnits: "meters",
          getSize: 40,
          sizeMinPixels: 14,
          sizeMaxPixels: 50,
          getPosition: (d) => [d.lon, d.lat],
          getAngle: (d) => 90 - d.travelDeg,
          getColor: (d) => d.color,
          pickable: true,
          billboard: false,
          onHover: isMobile ? undefined : (info: any) => {
            setHover(info.object ? { x: info.x, y: info.y, segment: info.object } : null);
          },
          onClick: (info: any) => {
            if (info.object) setPinned({ x: info.x, y: info.y, segment: info.object });
            return true;
          },
        }),
      );
    }
    return result;
  }, [roads, segmentsWithWind, isMobile]);

  const stillLoading = !roads || !segments;
  const showWindError = windError && !windResult;
  const showDataError = dataError && stillLoading;
  const activeTip = pinned ?? hover;

  const topCardStyle: React.CSSProperties = isMobile
    ? { position: "absolute", top: 8, left: 8, right: 8 }
    : { position: "absolute", top: 16, right: 16 };
  const legendStyle: React.CSSProperties = isMobile
    ? { position: "absolute", bottom: pinned ? 200 : 8, left: 8, right: 8 }
    : { position: "absolute", bottom: 16, right: 16 };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        onClick={(info: any) => { if (!info.layer) setPinned(null); }}
      >
        <MapLibreMap reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>

      <div style={topCardStyle}>
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

      {windResult && !stillLoading && (
        <div style={legendStyle}>
          <Legend />
        </div>
      )}

      {activeTip && (
        <SegmentTooltip
          x={activeTip.x}
          y={activeTip.y}
          streetName={wayNames.get(String(activeTip.segment.wayId)) ?? null}
          modifiedSpeedMs={activeTip.segment.modifiedSpeedMs}
          travelDeg={activeTip.segment.travelDeg}
          canyonH={activeTip.segment.canyonH}
          canyonW={activeTip.segment.canyonW}
          variant={isMobile ? "sheet" : "cursor"}
          onClose={() => setPinned(null)}
        />
      )}

      <About />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MapApp />
    </ErrorBoundary>
  );
}