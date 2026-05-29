// src/api/weather.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCurrentWind } from './weather';

const MOCK_RESPONSE = {
  latitude: 55.68,
  longitude: 12.56,
  elevation: 5,
  current_units: {
    wind_speed_10m: 'm/s',
    wind_direction_10m: '°',
    wind_gusts_10m: 'm/s',
  },
  current: {
    time: '2026-05-29T17:00',
    wind_speed_10m: 4.2,
    wind_direction_10m: 245,
    wind_gusts_10m: 7.8,
  },
};

describe('fetchCurrentWind', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses Open-Meteo response into Wind shape', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    });

    const result = await fetchCurrentWind(55.68, 12.56);

    expect(result.wind).toEqual({
      speedMs: 4.2,
      directionDeg: 245,
      gustMs: 7.8,
    });
    expect(result.timestamp).toBe('2026-05-29T17:00');
    expect(result.source).toEqual({ lat: 55.68, lon: 12.56, elevationM: 5 });
  });

  it('throws on non-OK HTTP response', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(fetchCurrentWind(55.68, 12.56)).rejects.toThrow(/503/);
  });

  it('throws when response is missing the current object', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ latitude: 55, longitude: 12 }),
    });

    await expect(fetchCurrentWind(55.68, 12.56)).rejects.toThrow(/current/);
  });

  it('builds the correct URL with all required parameters', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    });

    await fetchCurrentWind(55.68, 12.56);

    const callUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('latitude=55.68');
    expect(callUrl).toContain('longitude=12.56');
    expect(callUrl).toContain('wind_speed_unit=ms');
    expect(callUrl).toContain('current=wind_speed_10m');
  });
});