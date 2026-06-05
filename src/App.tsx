// src/App.tsx
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import DeckGL from "@deck.gl/react";
import { PathLayer, ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import { WebMercatorViewport } from "@deck.gl/core";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import type * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection } from "geojson";
import { useCurrentWind } from "./hooks/useCurrentWind";
import { reverseGeocode } from "./api/geocode";
import { arrowDensityForZoom, roadWidthForHighway, type RawSegment } from "./layers/buildWindArrows";
import { buildFlowField, createFlowLineLayer, type FlowLine } from "./layers/FlowLineLayer";
import { rankRoutes, type RouteOption, type RankCriterion } from "./routing/windRoute";
import type { OutMsg } from "./routing/routingWorker";
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
  arrow: FlowLine;
}

const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };
// "Daylight" — a clean light basemap, then recoloured at runtime (applyDaylight)
// into the warm "Copenhagen Morning" palette (see THEME).
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MOBILE_BREAKPOINT = 768;

// "Copenhagen Morning" palette — warm linen land, harbour-tinted teal water,
// fresh parks, warm-bone buildings. A daylight feel of its own, not an Apple clone:
// the water leans aqua-teal (the harbour) rather than sky-blue, parks are livelier,
// and labels sit on a slightly deeper ink for crisper reading.
const THEME = {
  land: "#f2ede2",
  water: "#9ed3d8",
  park: "#c6dca8",
  road: "#ffffff",
  roadCasing: "#e8dfcc",
  building: "#ebe4d4",
  boundary: "#d8ccb6",
  ink: "#3d4856",
  halo: "#f7f2e9",
};
const BUILDING_RGB: [number, number, number] = [235, 228, 212]; // matches THEME.building

// Recolour the light basemap into the Daylight palette. Carto's gl styles use
// well-named layers, so we classify by id/type and repaint role by role — robust
// to the exact layer set, and far less code than authoring a full style.json.
function applyDaylight(map: maplibregl.Map) {
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    const id = l.id.toLowerCase();
    const set = (prop: string, val: unknown) => {
      try { map.setPaintProperty(l.id, prop as any, val as any); } catch { /* layer lacks prop */ }
    };
    try {
      if (l.type === "background") { set("background-color", THEME.land); continue; }
      if (id.includes("water") && !id.includes("name") && !id.includes("label")) {
        set("fill-color", THEME.water); set("line-color", THEME.water); continue;
      }
      if (/(park|wood|grass|green|forest|landcover|pitch|cemetery|scrub|garden)/.test(id) && l.type === "fill") {
        set("fill-color", THEME.park); set("fill-opacity", 0.85); continue;
      }
      if (id.includes("building") && l.type === "fill") {
        set("fill-color", THEME.building); set("fill-opacity", 0.65); continue;
      }
      if (id.includes("boundary") && l.type === "line") { set("line-color", THEME.boundary); continue; }
      if (/(road|street|bridge|tunnel|transit|rail|highway|path)/.test(id) && l.type === "line") {
        set("line-color", id.includes("casing") || id.includes("outline") ? THEME.roadCasing : THEME.road);
        continue;
      }
      if (l.type === "symbol") {
        set("text-color", THEME.ink);
        set("text-halo-color", THEME.halo);
        set("text-halo-width", 1.3);
      }
    } catch { /* skip any uncooperative layer */ }
  }
}

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
//
// Each tick re-renders the app, so we cap the emit rate via minIntervalMs (30 fps
// on phones) — the drift advances by real elapsed time, so motion stays the same
// speed, we just spend half the CPU on a mobile GPU/CPU. 0 = every frame.
function useFlowPhase(minIntervalMs = 0) {
  const [flowPhase, setFlowPhase] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let lastEmit = performance.now();
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const dt = now - lastEmit;
      if (dt < minIntervalMs) return;
      lastEmit = now;
      setFlowPhase((p) => (p + dt / 1000) % 3600);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [minIntervalMs]);

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
// Each street gets a few arrows whose positions are recomputed per frame on the CPU,
// so cap how many streets we draw (thinned evenly across the view) to stay smooth.
const MAX_FLOW_STREETS_MOBILE = 650;
const MAX_FLOW_STREETS_DESKTOP = 1700;

function MapApp() {
  const isMobile = useIsMobile();
  // 30 fps on phones (now that 3D is off there's headroom for a livelier field),
  // 60 on desktop.
  const flowPhase = useFlowPhase(isMobile ? 1000 / 30 : 0);
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
  // Human-readable labels for the From/To fields (address or "My location").
  const [startLabel, setStartLabel] = useState<string | null>(null);
  const [endLabel, setEndLabel] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [criterion, setCriterion] = useState<RankCriterion>("recommended");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Routing runs in a Web Worker (graph build + A* would otherwise freeze the UI,
  // especially on phones). The worker owns the 121k-node graph; we post requests
  // and receive route options asynchronously. Ranking by criterion is cheap (≤4
  // options) so it stays on the main thread — switching criterion never re-plans.
  const workerRef = useRef<Worker | null>(null);
  const graphSentRef = useRef(false);
  const reqIdRef = useRef(0);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [routeComputing, setRouteComputing] = useState(false);

  // Spin up the worker and hand it the road network the first time routing opens.
  useEffect(() => {
    if (!routing || !roads) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./routing/routingWorker.ts", import.meta.url), { type: "module" });
      workerRef.current.onmessage = (e: MessageEvent<OutMsg>) => {
        const msg = e.data;
        if (msg.type === "routes") {
          // Ignore results from a superseded request (rider moved a pin meanwhile).
          if (msg.reqId !== reqIdRef.current) return;
          setRouteOptions(msg.options);
          setRouteComputing(false);
        }
      };
    }
    if (!graphSentRef.current) {
      graphSentRef.current = true;
      workerRef.current.postMessage({ type: "init", roads });
    }
  }, [routing, roads]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Ask the worker for routes whenever the endpoints or live wind change.
  useEffect(() => {
    if (!routing || !workerRef.current) return;
    if (!start || !end || !windResult) {
      setRouteOptions([]);
      setRouteComputing(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setRouteComputing(true);
    workerRef.current.postMessage({ type: "plan", reqId, start, end, wind: windResult.wind });
  }, [routing, start, end, windResult]);

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
    setStart(null); setEnd(null); setStartLabel(null); setEndLabel(null);
    setSelectedRouteId(null); setGpsError(null);
  }, []);

  const toggleRouting = useCallback(() => {
    setRouting((r) => !r);
    setPinned(null); setHover(null);
  }, []);

  // Ease the camera to frame the chosen point(s): centre on one, fit-bounds on two.
  const framePoints = useCallback((pts: LatLon[]) => {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      setViewState((vs) => constrainView({ ...vs, longitude: pts[0].lon, latitude: pts[0].lat, zoom: Math.max(vs.zoom ?? 14, 14) }));
      return;
    }
    const lons = pts.map((p) => p.lon);
    const lats = pts.map((p) => p.lat);
    try {
      const { longitude, latitude, zoom } = new WebMercatorViewport({
        width: windowSize.width,
        height: windowSize.height,
      }).fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: isMobile ? 56 : 110 },
      );
      setViewState((vs) => constrainView({ ...vs, longitude, latitude, zoom: Math.min(zoom, MAX_ZOOM) }));
    } catch { /* identical/degenerate points — leave the view as is */ }
  }, [windowSize.width, windowSize.height, isMobile]);

  // Best-effort: fill a waypoint's label with its nearest address after a tap/GPS.
  const reverseFill = useCallback((which: "start" | "end", lat: number, lon: number) => {
    reverseGeocode(lat, lon)
      .then((label) => { if (label) (which === "start" ? setStartLabel : setEndLabel)(label); })
      .catch(() => { /* keep the placeholder label */ });
  }, []);

  const pickStart = useCallback((wp: { lat: number; lon: number; label: string }) => {
    const p = { lat: wp.lat, lon: wp.lon };
    setStart(p); setStartLabel(wp.label); setSelectedRouteId(null); setGpsError(null);
    framePoints(end ? [p, end] : [p]);
  }, [end, framePoints]);

  const pickEnd = useCallback((wp: { lat: number; lon: number; label: string }) => {
    const p = { lat: wp.lat, lon: wp.lon };
    setEnd(p); setEndLabel(wp.label); setSelectedRouteId(null);
    framePoints(start ? [start, p] : [p]);
  }, [start, framePoints]);

  const clearStart = useCallback(() => { setStart(null); setStartLabel(null); setSelectedRouteId(null); }, []);
  const clearEnd = useCallback(() => { setEnd(null); setEndLabel(null); setSelectedRouteId(null); }, []);

  const swapEnds = useCallback(() => {
    setStart(end); setEnd(start);
    setStartLabel(endLabel); setEndLabel(startLabel);
    setSelectedRouteId(null);
  }, [start, end, startLabel, endLabel]);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsError("Geolocation not available in this browser."); return; }
    setGpsLoading(true); setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        setStart({ lat, lon }); setStartLabel("My location"); setSelectedRouteId(null); setGpsLoading(false);
        setViewState((vs) => constrainView({ ...vs, longitude: lon, latitude: lat, zoom: Math.max(vs.zoom ?? 14, 14) }));
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
  // enough to see extrusions — never on first paint, so the map opens fast. Phones
  // skip 3D entirely (the fetch + per-frame extrusion is the main mobile cost).
  const wantBuildings = !isMobile && !!roads && (viewState.zoom ?? 0) >= BUILDINGS_MIN_ZOOM;
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

  const flowLines = useMemo<FlowLine[]>(() => {
    if (!enrichedSegments || !windResult || !boundsKey || density === "hidden") return [];
    const [west, south, east, north] = boundsKey.split(",").map(Number);
    let visible = enrichedSegments.filter(
      (s) => s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north,
    );
    // Thin streets evenly across the view to bound the per-frame arrow count.
    const cap = isMobile ? MAX_FLOW_STREETS_MOBILE : MAX_FLOW_STREETS_DESKTOP;
    if (visible.length > cap) {
      const stride = Math.ceil(visible.length / cap);
      visible = visible.filter((_, i) => i % stride === 0);
    }
    return buildFlowField(visible, windResult.wind);
  }, [enrichedSegments, windResult, density, boundsKey, isMobile]);

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

  // 3D building extrusions sit at the bottom of the stack. Memoised separately so
  // they are NOT rebuilt on every animation frame (only when the visible set
  // changes) — extruding ~thousands of footprints 60×/s would crush a phone.
  const buildingLayers = useMemo(() => {
    if (!roads || !visibleBuildings || visibleBuildings.length === 0) return [];
    return [
      new PolygonLayer<BuildingRow>({
        id: "buildings",
        data: visibleBuildings,
        extruded: true,
        getPolygon: (d) => d[1],
        getElevation: (d) => d[0],
        getFillColor: [...BUILDING_RGB, 244],
        stroked: false,
        // Matte, warmly-lit ivory — soft daylight shading, no harsh speculars.
        material: { ambient: 0.72, diffuse: 0.55, shininess: 8, specularColor: [60, 58, 52] },
        pickable: false,
      }),
    ];
  }, [roads, visibleBuildings]);

  // Routes + endpoints draw on TOP of the wind arrows. Also kept off the per-frame
  // path so the route polylines aren't rebuilt while arrows animate.
  const routeLayers = useMemo(() => {
    const result: any[] = [];
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
            o.id === selectedRoute?.id ? [46, 124, 246, 255]
            : o.id === bestId ? [31, 157, 87, 240]
            : [108, 122, 140, 205],
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
  }, [routing, rankedRoutes, selectedRoute, bestId, start, end]);

  // Animated dashed flow streaks (oriented in the wind direction). Rebuilt per frame
  // (flowPhase), but that only updates a single GPU time uniform — the path/color
  // attributes are unchanged, so it's cheap. Also the pick target for the tooltip.
  const flowLinesLayer = useMemo(() => {
    if (flowLines.length === 0) return null;
    return createFlowLineLayer({
      data: flowLines,
      time: flowPhase,
      isMobile,
      // While planning a route, clicks set waypoints instead of pinning a street.
      onHover: isMobile || routing ? undefined : (info) => {
        setHover(info.object ? { x: info.x, y: info.y, arrow: info.object } : null);
      },
      onClick: routing ? undefined : (info) => {
        if (info.object) setPinned({ x: info.x, y: info.y, arrow: info.object });
        return true;
      },
    });
  }, [flowLines, flowPhase, isMobile, routing]);

  const layers = useMemo(
    () => [...buildingLayers, ...(flowLinesLayer ? [flowLinesLayer] : []), ...routeLayers],
    [buildingLayers, flowLinesLayer, routeLayers],
  );

  const stillLoading = !roads || !segments;
  const showWindError = windError && !windResult;
  const showDataError = dataError && stillLoading;
  const activeTip = pinned ?? hover;

  const onMapClick = useCallback((info: any) => {
    if (routing && info.coordinate) {
      const [lon, lat] = info.coordinate;
      setSelectedRouteId(null);
      setGpsError(null);
      if (!start) {
        setStart({ lat, lon }); setStartLabel("Dropped pin"); reverseFill("start", lat, lon);
      } else if (!end) {
        setEnd({ lat, lon }); setEndLabel("Dropped pin"); reverseFill("end", lat, lon);
      } else {
        // Both set → start a fresh pair from the new tap.
        setStart({ lat, lon }); setStartLabel("Dropped pin"); reverseFill("start", lat, lon);
        setEnd(null); setEndLabel(null);
      }
      return;
    }
    if (!info.layer) setPinned(null);
  }, [routing, start, end, reverseFill]);

  const routeDrawerStyle: React.CSSProperties = isMobile
    ? {
        position: "absolute",
        bottom: "calc(env(safe-area-inset-bottom) + 8px)",
        left: "calc(env(safe-area-inset-left) + 8px)",
        right: "calc(env(safe-area-inset-right) + 8px)",
        zIndex: 25,
      }
    : { position: "absolute", top: 78, left: 14, zIndex: 25 };
  const legendStyle: React.CSSProperties = isMobile
    ? {
        position: "absolute",
        bottom: pinned ? 200 : "calc(env(safe-area-inset-bottom) + 10px)",
        left: "calc(env(safe-area-inset-left) + 10px)",
        zIndex: 20,
      }
    : { position: "absolute", bottom: 16, right: 16, zIndex: 20 };

  return (
    <div className="app-root" style={{ position: "relative", background: THEME.land, overflow: "hidden" }}>
      <DeckGL
        initialViewState={initialViewState}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        // `true` (a stable primitive) — a controller *object* here re-inits gestures
        // and breaks tap-to-place waypoints on touch. Keep deck's standard handling.
        controller={true}
        layers={layers}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : routing ? "crosshair" : "grab")}
        onClick={onMapClick}
      >
        <MapLibreMap
          reuseMaps
          mapStyle={MAP_STYLE}
          // Hide the on-map credit line (it overlapped the wind scale on phones);
          // full OSM / CARTO / MapLibre attribution lives in the About dialog.
          attributionControl={false}
          onLoad={(e: { target: maplibregl.Map }) => applyDaylight(e.target)}
        />
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
      <div style={{ position: "absolute", top: isMobile ? "calc(env(safe-area-inset-top) + 58px)" : 76, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 8, zIndex: 20, pointerEvents: "none" }}>
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
            startLabel={startLabel}
            endLabel={endLabel}
            onPickStart={pickStart}
            onPickEnd={pickEnd}
            onClearStart={clearStart}
            onClearEnd={clearEnd}
            onSwap={swapEnds}
            building={routeComputing}
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
          gustMs={activeTip.arrow.gustMs}
          travelDeg={activeTip.arrow.flowDeg}
          bearingDeg={activeTip.arrow.bearingDeg}
          canyonH={activeTip.arrow.canyonH}
          canyonW={activeTip.arrow.canyonW}
          leftHeightM={activeTip.arrow.leftHeightM}
          rightHeightM={activeTip.arrow.rightHeightM}
          geometrySource={activeTip.arrow.geometrySource}
          laneIndex={0}
          laneCount={1}
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


