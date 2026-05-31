// src/components/WindCard.tsx
import type { Wind } from '../math';

interface Props {
  wind: Wind;
  timestamp?: string;
  segmentCount: number;
}

function compassPoint(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

function Compass({ directionDeg, size = 64 }: { directionDeg: number; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  return (
    <svg width={size} height={size} aria-label="Wind compass">
      <circle cx={cx} cy={cy} r={r} fill="#fafafa" stroke="#ccc" strokeWidth={1} />
      <text x={cx} y={9} textAnchor="middle" fontSize={9} fill="#666" fontWeight="600">N</text>
      <text x={size - 4} y={cy + 4} textAnchor="middle" fontSize={9} fill="#888">E</text>
      <text x={cx} y={size - 2} textAnchor="middle" fontSize={9} fill="#888">S</text>
      <text x={5} y={cy + 4} textAnchor="middle" fontSize={9} fill="#888">W</text>
      <g transform={`rotate(${directionDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 8} stroke="#c33" strokeWidth={2.5} strokeLinecap="round" />
        <polygon
          points={`${cx - 4},${cy - r + 12} ${cx + 4},${cy - r + 12} ${cx},${cy - r + 4}`}
          fill="#c33"
        />
        <circle cx={cx} cy={cy} r={2.5} fill="#c33" />
      </g>
    </svg>
  );
}

export default function WindCard({ wind, timestamp, segmentCount }: Props) {
  const dirText = `${compassPoint(wind.directionDeg)} (${Math.round(wind.directionDeg)}°)`;
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        padding: '12px 14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#222',
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        Copenhagen — Live
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Compass directionDeg={wind.directionDeg} size={56} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>
            {wind.speedMs.toFixed(1)}
            <span style={{ fontSize: 12, color: '#666', marginLeft: 4 }}>m/s</span>
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>from {dirText}</div>
          {wind.gustMs !== undefined && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              gusts {wind.gustMs.toFixed(1)} m/s
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #eee', fontSize: 10, color: '#888' }}>
        Canyon-modified across {segmentCount.toLocaleString()} street segments
        {timestamp && <div style={{ marginTop: 2 }}>updated {new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>}
      </div>
    </div>
  );
}