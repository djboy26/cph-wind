// src/api/geocode.ts
// Place search + reverse geocoding via Photon (photon.komoot.io) — OSM-based,
// keyless, built for type-as-you-go autocomplete. CORS-open, so it runs in the
// browser. Results are biased and bounded to Greater Copenhagen (the map is locked
// there anyway), and normalised into a tidy primary/secondary label pair.

const PHOTON_SEARCH = "https://photon.komoot.io/api/";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse/";

// Proximity bias (city centre) + a hard bbox so results stay local.
const BIAS = { lat: 55.6761, lon: 12.5683 };
const BBOX = "12.30,55.50,12.80,55.85"; // minLon,minLat,maxLon,maxLat

export interface Place {
  lat: number;
  lon: number;
  /** Headline: a POI name, or "Street 12", or a locality. */
  primary: string;
  /** Context line: street / postcode / city, or "". */
  secondary: string;
  /** Stable React key. */
  key: string;
}

type PhotonProps = Record<string, string | number | undefined>;

function formatPlace(p: PhotonProps): { primary: string; secondary: string } {
  const housenumber = p.housenumber as string | undefined;
  const street = (p.street as string | undefined) ?? (p.name as string | undefined);
  const streetLine = [street, housenumber].filter(Boolean).join(" ");
  const locality = p.city ?? p.town ?? p.village ?? p.district ?? p.county;
  const cityLine = [p.postcode, locality].filter(Boolean).join(" ");

  const primary =
    (p.name as string | undefined) || streetLine || (locality as string | undefined) || "Unnamed place";

  const secondary: string[] = [];
  if (p.name && streetLine && streetLine !== p.name) secondary.push(streetLine);
  if (cityLine) secondary.push(cityLine);
  else if (p.state) secondary.push(String(p.state));

  return { primary, secondary: secondary.join(", ") };
}

function toPlaces(geojson: unknown): Place[] {
  const features = (geojson as { features?: unknown[] })?.features ?? [];
  const out: Place[] = [];
  features.forEach((f, i) => {
    const feat = f as { geometry?: { coordinates?: [number, number] }; properties?: PhotonProps };
    const coords = feat.geometry?.coordinates;
    if (!coords) return;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const props = feat.properties ?? {};
    const { primary, secondary } = formatPlace(props);
    out.push({ lat, lon, primary, secondary, key: `${props.osm_type ?? ""}${props.osm_id ?? i}-${lat},${lon}` });
  });
  return out;
}

/** Type-ahead place search. Returns [] for queries shorter than 2 chars. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url =
    `${PHOTON_SEARCH}?q=${encodeURIComponent(q)}&limit=6&lang=en` +
    `&lat=${BIAS.lat}&lon=${BIAS.lon}&bbox=${BBOX}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geocoder ${res.status}`);
  return toPlaces(await res.json());
}

/** Nearest address to a coordinate (for labelling a tapped/located point). */
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON_REVERSE}?lat=${lat}&lon=${lon}&lang=en&limit=1`, { signal });
    if (!res.ok) return null;
    const [place] = toPlaces(await res.json());
    if (!place) return null;
    return place.secondary ? `${place.primary}, ${place.secondary}` : place.primary;
  } catch {
    return null;
  }
}
