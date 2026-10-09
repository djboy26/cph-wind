import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { inServiceArea, roundCoord } from '../../api/wind';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; },
    json(body: unknown) { res.body = body; },
    send(body: string) { res.body = body; },
  };
  return res;
}

describe('api/wind proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn();
  });

  it('serves Copenhagen and refuses the rest of the planet', () => {
    expect(inServiceArea(55.6761, 12.5683)).toBe(true);
    expect(inServiceArea(51.5074, -0.1278)).toBe(false); // London
    expect(inServiceArea(35.6812, 139.7671)).toBe(false); // Tokyo
  });

  it('rounds to 2 decimals for the upstream call', () => {
    expect(roundCoord(55.6761)).toBe('55.68');
    expect(roundCoord(12.5683)).toBe('12.57');
  });

  it('answers 400 outside the service area without calling MET', async () => {
    const res = mockRes();
    await handler({ query: { lat: '48.8566', lon: '2.3522' } }, res);
    expect(res.statusCode).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('calls MET with rounded coordinates and a stale-if-error cache policy', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => '{"properties":{"timeseries":[]}}',
      headers: { get: () => null },
    } as unknown as Response);
    const res = mockRes();
    await handler({ query: { lat: '55.6761', lon: '12.5683' } }, res);
    const url = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(url).toContain('lat=55.68&lon=12.57');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('stale-if-error=3600');
  });

  it('rejects non-numeric input', async () => {
    const res = mockRes();
    await handler({ query: { lat: 'abc', lon: '12.5' } }, res);
    expect(res.statusCode).toBe(400);
  });
});
