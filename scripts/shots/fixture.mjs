// scripts/shots/fixture.mjs
// A MET-Norway-shaped wind response, so every screenshot run sees the same weather
// and two runs of the same commit differ only in what the code draws.
export function metFixture({ speed, dir, gust, easeTo = null, rainNow = 0 }) {
  const now = new Date(); now.setMinutes(0, 0, 0);
  const timeseries = [];
  for (let i = 0; i < 30; i++) {
    const t = new Date(now.getTime() + i * 3600e3);
    const s = easeTo !== null && i >= 3 ? easeTo : speed;
    const g = easeTo !== null && i >= 3 ? easeTo * 1.5 : gust;
    timeseries.push({
      time: t.toISOString(),
      data: {
        instant: { details: { air_temperature: 15.2, relative_humidity: 70, wind_from_direction: dir, wind_speed: s, wind_speed_of_gust: g } },
        next_1_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: i === 0 ? rainNow : 0 } },
      },
    });
  }
  return { type: "Feature", geometry: { type: "Point", coordinates: [12.5683, 55.6761, 10] }, properties: { meta: { updated_at: now.toISOString(), units: {} }, timeseries } };
}

/** Two real places 2.5 km apart across the centre, for the route panel shots. */
export const PLACES = {
  start: { lon: 12.5713, lat: 55.6835 }, // Nørreport
  end: { lon: 12.5786, lat: 55.6656 }, //   Islands Brygge
};
