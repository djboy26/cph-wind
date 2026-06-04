// src/App.tsx
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import DeckGL from "@deck.gl/react";
import { PathLayer, ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import { WebMercatorViewport } from "@deck.gl/core";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection } from "geojson";
import { useCurrentWind } from "./hooks/useCurrentWind";
import { arrowDensityForZoom, buildWindArrows, roadWidthForHighway, type RawSegment } from "./layers/buildWindArrows";
import { createWindFlowLayer, type WindArrowInstance } from "./layers/WindFlowLayer";
import { buildGraph, nearestNode } from "./routing/graph";
import { planRoutes, rankRoutes, type RouteOption, type RankCriterion } from "./routing/windRoute";
import TopBar from "./components/TopBar";
import Legend from "./components/Legend";
import SegmentTooltip from "./components/SegmentTooltip";
import RoutePanel from "./components/RoutePanel";
import About from "./components/About";
import OnboardingHint from "./components/OnboardingHint";
import { glass, COLORS } from "./components/ui";
import "./components/ui.css";

const statusChip = (color: string): React.CSSProperties => ({
  ...glass,
  padding: "8px 14px",
  borderRadius: 12,
  fontSize: 13,
  color,
});

interface LatLon { lat: number; lon: number; }

// One row of the slim buildings file: [heightM, outerRing as [lon,lat] pairs].
type BuildingRow = [number, [number, number][]];

interface HoverState {
  x: number;
  y: number;
  arrow: WindArrowInstance;
}

const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MOBILE_BREAKPOINT = 768;

// Hard-lock the camera to Greater Copenhagen (data bounds + a little padding) so
// the map can never wander off to another city or country.
const GCPH = { minLon: 12.34, maxLon: 12.78, minLat: 55.54, maxLat: 55.82 };
const MIN_ZOOM = 11;
const MAX_ZOOM = 18.5;
// 3D buildings: only fetch/render once the rider zooms in past the city overview
// (the slim file is ~42 MB, so we load it lazily, not on first paint).
const BUILDINGS_MIN_ZOOM = 14;
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function constrainView<T extends { longitude?: number; latitude?: number; zoom?: number }>(vs: T): T {
  return {
    ...vs,
    longitude: clampN(vs.longitude ?? COPENHAGEN.lon, GCPH.minLon, GCPH.maxLon),
    latitude: clampN(vs.latitude ?? COPENHAGEN.lat, GCPH.minLat, GCPH.maxLat),
    zoom: clampN(vs.zoom ?? 12, MIN_ZOOM, MAX_ZOOM),
  };
}

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
    zoom: isMobile ? 13 : 13.5, // arrows appear from zoom 13 — open already showing wind
    pitch: isMobile ? 0 : 40,
    bearing: 0,
  }), [isMobile]);

  const [viewState, setViewState] = useState(initialViewState);

  const { data: windResult, loading: windLoading, error: windError } = useCurrentWind(
    COPENHAGEN.lat, COPENHAGEN.lon,
  );

  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [segments, setSegments] = useState<RawSegment[] | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[] | null>(null);
  const buildingsReq = useRef(false);
  const [dataError, setDataError] = useState<Error | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<HoverState | null>(null);

  // --- Route planning ---
  const [routing, setRouting] = useState(false);
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [criterion, setCriterion] = useState<RankCriterion>("recommended");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Build the routing graph once, the first time route planning is opened; cached
  // thereafter (routeReady stays true, so toggling the panel never rebuilds it).
  const [routeReady, setRouteReady] = useState(false);
  const graph = useMemo(
    () => (routeReady && roads ? buildGraph(roads) : null),
    [routeReady, roads],
  );

  const routeOptions = useMemo<RouteOption[]>(() => {
    if (!routing || !graph || !start || !end || !windResult) return [];
    const s = nearestNode(graph, start.lon, start.lat);
    const g = nearestNode(graph, end.lon, end.lat);
    return planRoutes(graph, s, g, windResult.wind);
  }, [routing, graph, start, end, windResult]);

  // Rank by the rider's chosen criterion; the winner is the highlighted "best".
  const { sorted: rankedRoutes, bestId } = useMemo(
    () => rankRoutes(routeOptions, criterion),
    [routeOptions, criterion],
  );

  const selectedRoute =
    rankedRoutes.find((o) => o.id === selectedRouteId)
    ?? rankedRoutes.find((o) => o.id === bestId)
    ?? rankedRoutes[0] ?? null;

  const resetRoute = useCallback(() => {
    setStart(null); setEnd(null); setSelectedRouteId(null); setGpsError(null);
  }, []);

  const toggleRouting = useCallback(() => {
    setRouteReady(true); // once opened, keep the graph cached even if closed
    setRouting((r) => !r);
    setPinned(null); setHover(null);
  }, []);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsError("Geolocation not available in this browser."); return; }
    setGpsLoading(true); setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setEnd(null); setSelectedRouteId(null); setGpsLoading(false);
        setViewState((vs) => ({ ...vs, longitude: pos.coords.longitude, latitude: pos.coords.latitude, zoom: Math.max(vs.zoom ?? 14, 14) }));
      },
      (err) => { setGpsLoading(false); setGpsError(`Location failed: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

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

  // Lazily pull the ~42 MB 3D-buildings file the first time the rider zooms in far
  // enough to see extrusions — never on first paint, so the map opens fast.
  const wantBuildings = !!roads && (viewState.zoom ?? 0) >= BUILDINGS_MIN_ZOOM;
  useEffect(() => {
    if (!wantBuildings || buildingsReq.current) return;
    buildingsReq.current = true;
    fetch("/data/cph-buildings-slim.json")
      .then((r) => { if (!r.ok) throw new Error(`Buildings ${r.status}`); return r.json(); })
      .then((b: BuildingRow[]) => setBuildings(b))
      .catch((e) => { console.warn("3D buildings failed to load:", e); buildingsReq.current = false; });
  }, [wantBuildings]);

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

  // Only extrude the buildings inside the (padded) viewport box — 220k city-wide
  // footprints would choke the GPU. boundsKey already snaps to a coarse grid, so
  // this re-filters only when the view moves a meaningful amount.
  const visibleBuildings = useMemo(() => {
    if (!buildings || !boundsKey || (viewState.zoom ?? 0) < BUILDINGS_MIN_ZOOM) return null;
    const [west, south, east, north] = boundsKey.split(",").map(Number);
    return buildings.filter((b) => {
      const [lon, lat] = b[1][0];
      return lon >= west && lon <= east && lat >= south && lat <= north;
    });
  }, [buildings, boundsKey, viewState.zoom]);

  const onViewStateChange = useCallback(({ viewState: vs }: { viewState: Record<string, unknown> }) => {
    setViewState(constrainView(vs as typeof viewState));
  }, []);

  const layers = useMemo(() => {
    if (!roads) return [];
    // The dark basemap already draws the road network, so no baseline overlay —
    // cleaner and faster (no 24k extra lines).
    const result: any[] = [];
    // 3D building extrusions sit at the bottom of the stack so wind arrows and
    // routes always draw on top of them.
    if (visibleBuildings && visibleBuildings.length > 0) {
      result.push(
        new PolygonLayer<BuildingRow>({
          id: "buildings",
          data: visibleBuildings,
          extruded: true,
          getPolygon: (d) => d[1],
          getElevation: (d) => d[0],
          getFillColor: [42, 48, 60, 235],
          stroked: false,
          material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [50, 60, 80] },
          pickable: false,
        }),
      );
    }
    if (windArrows.length > 0) {
      result.push(
        createWindFlowLayer({
          data: windArrows,
          flowPhase,
          // While planning a route, clicks set waypoints instead of pinning arrows.
          onHover: isMobile || routing ? undefined : (info) => {
            setHover(info.object ? { x: info.x, y: info.y, arrow: info.object } : null);
          },
          onClick: routing ? undefined : (info) => {
            if (info.object) setPinned({ x: info.x, y: info.y, arrow: info.object });
            return true;
          },
        }),
      );
    }
    if (routing && rankedRoutes.length > 0) {
      // Draw unselected first, selected last so it sits on top.
      const ordered = [...rankedRoutes].sort(
        (a, b) => (a.id === selectedRoute?.id ? 1 : 0) - (b.id === selectedRoute?.id ? 1 : 0),
      );
      result.push(
        new PathLayer<RouteOption>({
          id: "routes",
          data: ordered,
          getPath: (o) => o.coords,
          getColor: (o) =>
            o.id === selectedRoute?.id ? [70, 150, 255, 255]
            : o.id === bestId ? [70, 209, 138, 235]
            : [165, 174, 186, 190],
          getWidth: (o) => (o.id === selectedRoute?.id ? 7 : 4),
          widthUnits: "pixels",
          widthMinPixels: 3,
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onClick: (info: any) => { if (info.object) { setSelectedRouteId(info.object.id); return true; } return false; },
          updateTriggers: { getColor: `${selectedRoute?.id}|${bestId}`, getWidth: selectedRoute?.id },
        }),
      );
    }
    if (routing && (start || end)) {
      const pts = [
        start && { pos: [start.lon, start.lat], color: [40, 160, 90] },
        end && { pos: [end.lon, end.lat], color: [210, 50, 50] },
      ].filter(Boolean) as { pos: [number, number]; color: [number, number, number] }[];
      result.push(
        new ScatterplotLayer({
          id: "route-endpoints",
          data: pts,
          getPosition: (d: any) => d.pos,
          getFillColor: (d: any) => d.color,
          getRadius: 7,
          radiusUnits: "pixels",
          radiusMinPixels: 6,
          stroked: true,
          getLineColor: [255, 255, 255],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }
    return result;
  }, [roads, visibleBuildings, windArrows, flowPhase, isMobile, routing, rankedRoutes, selectedRoute, bestId, start, end]);

  const stillLoading = !roads || !segments;
  const showWindError = windError && !windResult;
  const showDataError = dataError && stillLoading;
  const activeTip = pinned ?? hover;

  const onMapClick = useCallback((info: any) => {
    if (routing && info.coordinate) {
      const [lon, lat] = info.coordinate;
      setSelectedRouteId(null);
      setGpsError(null);
      if (!start) setStart({ lat, lon });
      else if (!end) setEnd({ lat, lon });
      else { setStart({ lat, lon }); setEnd(null); } // both set → begin a new pair
      return;
    }
    if (!info.layer) setPinned(null);
  }, [routing, start, end]);

  const routeDrawerStyle: React.CSSProperties = isMobile
    ? { position: "absolute", bottom: 8, left: 8, right: 8, zIndex: 25 }
    : { position: "absolute", top: 78, left: 14, zIndex: 25 };
  const legendStyle: React.CSSProperties = isMobile
    ? { position: "absolute", bottom: pinned ? 200 : 10, left: 10, zIndex: 20 }
    : { position: "absolute", bottom: 16, right: 16, zIndex: 20 };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#0e0f13", overflow: "hidden" }}>
      <DeckGL
        initialViewState={initialViewState}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={layers}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : routing ? "crosshair" : "grab")}
        onClick={onMapClick}
      >
        <MapLibreMap reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>

      <TopBar
        wind={windResult?.wind ?? null}
        timestamp={windResult?.timestamp}
        loading={windLoading && !windResult}
        routingActive={routing}
        onPlanRoute={toggleRouting}
        onAbout={() => setAboutOpen(true)}
        isMobile={isMobile}
      />

      {/* Transient status chips, centered just under the bar */}
      <div style={{ position: "absolute", top: isMobile ? 58 : 76, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 8, zIndex: 20, pointerEvents: "none" }}>
        {showDataError && <div className="ui-fade" style={statusChip(COLORS.bad)}>Data error: {dataError!.message}</div>}
        {showWindError && <div className="ui-fade" style={statusChip(COLORS.bad)}>Wind error: {windError!.message}</div>}
        {stillLoading && !dataError && <div className="ui-fade" style={statusChip(COLORS.dim)}>Loading streets…</div>}
        {windLoading && !windResult && !stillLoading && <div className="ui-fade" style={statusChip(COLORS.dim)}>Loading wind…</div>}
      </div>

      {routing && (
        <div className={isMobile ? "ui-sheet" : "ui-left"} style={routeDrawerStyle}>
          <RoutePanel
            active={routing}
            onToggle={toggleRouting}
            start={start}
            end={end}
            building={routing && !graph}
            gpsLoading={gpsLoading}
            gpsError={gpsError}
            onUseGps={useGps}
            onReset={resetRoute}
            options={rankedRoutes}
            bestId={bestId}
            selectedId={selectedRoute?.id ?? null}
            onSelect={setSelectedRouteId}
            criterion={criterion}
            onCriterion={setCriterion}
            isMobile={isMobile}
          />
        </div>
      )}

      {windResult && !stillLoading && !(routing && isMobile) && (
        <div style={legendStyle}>
          <Legend isMobile={isMobile} />
        </div>
      )}

      {!stillLoading && <OnboardingHint isMobile={isMobile} />}

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

      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
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
