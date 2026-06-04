// src/App.tsx
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";
import { WebMercatorViewport } from "@deck.gl/core";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection } from "geojson";
import { useCurrentWind } from "./hooks/useCurrentWind";
import { arrowDensityForZoom, buildWindArrows, roadWidthForHighway, type RawSegment } from "./layers/buildWindArrows";
import { createWindFlowLayer, type WindArrowInstance } from "./layers/WindFlowLayer";
import WindCard from "./components/Windcard";
import Legend from "./components/Legend";
import SegmentTooltip from "./components/SegmentTooltip";
import About from "./components/About";

interface HoverState {
  x: number;
  y: number;
  arrow: WindArrowInstance;
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

// Continuously increasing seconds (wrapped well above any animation cycle).
// The WindFlowLayer derives per-arrow drift from this, so keeping it smooth and
// unwrapped avoids visible jumps when arrows animate at different rates.
function useFlowPhase() {
  const [flowPhase, setFlowPhase] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setFlowPhase((p) => (p + dt / 1000) % 3600);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return flowPhase;
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
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

// Snap raw bounds to a coarse grid so arrows only rebuild when the view moves a
// meaningful amount, not on every pan frame.
const SNAP_DEG = 0.004;
const BOUNDS_PAD = 0.25;
const MAX_SPAN_DEG = 0.12;

function MapApp() {
  const isMobile = useIsMobile();
  const flowPhase = useFlowPhase();
  const windowSize = useWindowSize();

  const initialViewState = useMemo(() => ({
    longitude: COPENHAGEN.lon,
    latitude: COPENHAGEN.lat,
    zoom: isMobile ? 13 : 12,
    pitch: isMobile ? 0 : 45,
    bearing: 0,
  }), [isMobile]);

  const [viewState, setViewState] = useState(initialViewState);

  const { data: windResult, loading: windLoading, error: windError } = useCurrentWind(
    COPENHAGEN.lat, COPENHAGEN.lon,
  );

  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [segments, setSegments] = useState<RawSegment[] | null>(null);
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

  // Carriageway width per way, from the OSM highway class — used to confine arrows
  // to the road (the segments' stored width is the building-to-building canyon gap).
  const wayHighways = useMemo(() => {
    if (!roads) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const f of roads.features) {
      const p: any = f.properties || {};
      if (p.id != null && p.highway) m.set(String(p.id), p.highway);
    }
    return m;
  }, [roads]);

  const enrichedSegments = useMemo(() => {
    if (!segments) return null;
    return segments.map((s) => ({
      ...s,
      roadWidthM: roadWidthForHighway(wayHighways.get(String(s.wayId)), s.widthM ?? s.canyonW),
    }));
  }, [segments, wayHighways]);

  const zoom = viewState.zoom ?? initialViewState.zoom;
  const density = arrowDensityForZoom(zoom);

  // Padded, snapped viewport box (as a stable string key). Recomputed every frame
  // but only changes value when the view moves across a snap cell.
  const boundsKey = useMemo(() => {
    if (density === "hidden") return null;
    const vp = new WebMercatorViewport({
      width: windowSize.width,
      height: windowSize.height,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch ?? 0,
      bearing: viewState.bearing ?? 0,
    });
    let [west, south, east, north] = vp.getBounds();
    const padX = (east - west) * BOUNDS_PAD;
    const padY = (north - south) * BOUNDS_PAD;
    west -= padX; east += padX; south -= padY; north += padY;
    // Clamp span — a steep pitch can stretch bounds toward the horizon.
    if (east - west > MAX_SPAN_DEG) {
      const cx = (east + west) / 2;
      west = cx - MAX_SPAN_DEG / 2; east = cx + MAX_SPAN_DEG / 2;
    }
    if (north - south > MAX_SPAN_DEG) {
      const cy = (north + south) / 2;
      south = cy - MAX_SPAN_DEG / 2; north = cy + MAX_SPAN_DEG / 2;
    }
    west = Math.floor(west / SNAP_DEG) * SNAP_DEG;
    south = Math.floor(south / SNAP_DEG) * SNAP_DEG;
    east = Math.ceil(east / SNAP_DEG) * SNAP_DEG;
    north = Math.ceil(north / SNAP_DEG) * SNAP_DEG;
    return `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`;
  }, [density, windowSize.width, windowSize.height, viewState.longitude, viewState.latitude, viewState.zoom, viewState.pitch, viewState.bearing]);

  const windArrows = useMemo(() => {
    if (!enrichedSegments || !windResult || !boundsKey) return [];
    const [west, south, east, north] = boundsKey.split(",").map(Number);
    const visible = enrichedSegments.filter(
      (s) => s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north,
    );
    return buildWindArrows(visible, windResult.wind, density);
  }, [enrichedSegments, windResult, density, boundsKey]);

  const onViewStateChange = useCallback(({ viewState: vs }: { viewState: Record<string, unknown> }) => {
    setViewState(vs as typeof viewState);
  }, []);

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
    if (windArrows.length > 0) {
      result.push(
        createWindFlowLayer({
          data: windArrows,
          flowPhase,
          onHover: isMobile ? undefined : (info) => {
            setHover(info.object ? { x: info.x, y: info.y, arrow: info.object } : null);
          },
          onClick: (info) => {
            if (info.object) setPinned({ x: info.x, y: info.y, arrow: info.object });
            return true;
          },
        }),
      );
    }
    return result;
  }, [roads, windArrows, flowPhase, isMobile]);

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
        viewState={viewState}
        onViewStateChange={onViewStateChange}
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
            segmentCount={segments!.length}
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
          streetName={wayNames.get(String(activeTip.arrow.wayId)) ?? null}
          modifiedSpeedMs={activeTip.arrow.speedMs}
          travelDeg={activeTip.arrow.flowDeg}
          bearingDeg={activeTip.arrow.bearingDeg}
          canyonH={activeTip.arrow.canyonH}
          canyonW={activeTip.arrow.canyonW}
          leftHeightM={activeTip.arrow.leftHeightM}
          rightHeightM={activeTip.arrow.rightHeightM}
          geometrySource={activeTip.arrow.geometrySource}
          laneIndex={activeTip.arrow.laneIndex}
          laneCount={activeTip.arrow.laneCount}
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
