// src/components/Legend.tsx
// Color ramp legend for the per-street wind visualization.

const STOPS = [
  { v: 0, color: 'rgb(200,200,200)' },
  { v: 0.7, color: 'rgb(80,180,110)' },
  { v: 2, color: 'rgb(240,200,30)' },
  { v: 4, color: 'rgb(240,110,40)' },
  { v: 8, color: 'rgb(215,35,50)' },
];

const TICKS = [
  { v: 0, label: '0' },
  { v: 2, label: '2' },
  { v: 4, label: '4' },
  { v: 8, label: '8+' },
];

export default function Legend() {
  const gradient = `linear-gradient(to right, ${STOPS.map((s) => `${s.color} ${(s.v / 8) * 100}%`).join(', ')})`;
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        padding: '10px 14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#222',
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 11, color: '#444', marginBottom: 6 }}>
        Wind along street (m/s)
      </div>
      <div style={{ height: 10, background: gradient, borderRadius: 4 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666', marginTop: 4 }}>
        {TICKS.map((t) => (
          <span key={t.v}>{t.label}</span>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 6, lineHeight: 1.3 }}>
        Gray = perpendicular to wind. Brighter = wind aligned with that street.
      </div>
    </div>
  );
}