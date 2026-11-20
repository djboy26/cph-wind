// api/wind.ts
// Vercel serverless (Node) proxy for the MET Norway locationforecast API.
//
// Why this exists: browsers forbid setting the `User-Agent` header (it's a forbidden
// header), yet MET Norway's terms require an identifying User-Agent and they
// rate-limit / 403 anonymous-looking traffic. Proxying server-side lets us (1) set a
// proper UA, (2) add a shared CDN cache so we hit MET roughly once per location per
// cache window instead of once per visitor, and (3) shield clients from per-IP
// throttling.
//
// The client always calls `/api/wind?lat=&lon=`. In production this function answers;
// in local dev a Vite proxy forwards the same path to MET (see vite.config.ts), so
// the two environments behave identically.

const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
// MET asks for an identifying UA with a contact. Update if the repo moves.
const USER_AGENT = 'cph-wind/1.0 (+https://github.com/djboy26/cph-wind)';

// Minimal structural types for the Vercel request/response (avoids a @vercel/node
// dependency; the real objects supply exactly these members).
interface ProxyRequest {
  query: Record<string, string | string[] | undefined>;
}
interface ProxyResponse {
  status(code: number): ProxyResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

// The proxy answers only for places the app serves. Without this it is a free,
// anonymous MET Norway relay for the whole planet under our User-Agent, and abuse
// would get that User-Agent throttled or blocked for every rider. Widen this to the
// world index's city boxes when Milestone 2 adds cities.
export const SERVICE_AREA = { minLat: 55.3, maxLat: 56.1, minLon: 12.0, maxLon: 13.1 } as const;

/** Round to 2 decimals (~1.1 km): finer than MET's 2.5 km grid, coarse enough to share cache entries. */
export const roundCoord = (v: number): string => v.toFixed(2);

export function inServiceArea(lat: number, lon: number): boolean {
  return lat >= SERVICE_AREA.minLat && lat <= SERVICE_AREA.maxLat && lon >= SERVICE_AREA.minLon && lon <= SERVICE_AREA.maxLon;
}

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  const lat = Number(first(req.query.lat));
  const lon = Number(first(req.query.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Query params lat and lon are required numbers.' });
    return;
  }
  if (!inServiceArea(lat, lon)) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(400).json({ error: 'Outside the area this app serves.' });
    return;
  }

  const url = `${MET_URL}?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}`;
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!upstream.ok) {
      res.status(upstream.status === 429 ? 429 : 502).json({ error: `MET Norway returned ${upstream.status}.` });
      return;
    }
    const body = await upstream.text();
    // Respect MET's own cache window when present; otherwise default to 10 minutes.
    const expires = upstream.headers.get('expires');
    const ttl = expires ? Math.floor((Date.parse(expires) - Date.now()) / 1000) : 600;
    const sMaxAge = Number.isFinite(ttl) && ttl > 60 ? ttl : 600;
    res.setHeader('Content-Type', 'application/json');
    // stale-if-error: during a MET outage the CDN keeps serving the last forecast for an
    // hour instead of an error card.
    res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=600, stale-if-error=3600`);
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: `Wind proxy failed: ${(err as Error).message}` });
  }
}
