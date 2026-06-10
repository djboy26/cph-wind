// src/api/weather.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCurrentWind } from './weather';

// MET Norway Locationforecast (compact) response shape.
const MOCK_RESPONSE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [12.56, 55.68, 5] }, // [lon, lat, alt]
  properties: {
    timeseries: [
      {
        time: '2026-06-04T12:00:00Z',
        data: {
          instant: {
            details: {
              wind_speed: 4.2,
              wind_from_direction: 245,
              wind_speed_of_gust: 7.8,
            },
          },
        },
      },
    ],
  },
};

describe('fetchCurrentWind', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses MET Norway response into Wind shape', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const result = await fetchCurrentWind(55.68, 12.56);

    expect(result.wind).toEqual({
      speedMs: 4.2,
      directionDeg: 245,
      gustMs: 7.8,
    });
    expect(result.timestamp).toBe('2026-06-04T12:00:00Z');
    expect(result.source).toEqual({ lat: 55.68, lon: 12.56, elevationM: 5 });
  });

  it('throws on non-OK HTTP response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as Response);

    await expect(fetchCurrentWind(55.68, 12.56)).rejects.toThrow(/503/);
  });

  it('throws when response is missing the timeseries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'Feature', properties: {} }),
    } as Response);

    await expect(fetchCurrentWind(55.68, 12.56)).rejects.toThrow(/timeseries/);
  });

  it('calls the /api/wind proxy with rounded coordinates', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response);

    await fetchCurrentWind(55.68, 12.56);

    const callUrl = vi.mocked(globalThis.fetch).mock.calls[0][0];
    expect(callUrl).toContain('/api/wind');
    expect(callUrl).toContain('lat=55.6800');
    expect(callUrl).toContain('lon=12.5600');
  });
});
