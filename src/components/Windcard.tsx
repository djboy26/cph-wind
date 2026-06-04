// src/components/WindCard.tsx
import type { Wind } from '../math';
import { glass, COLORS } from './ui';

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
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
      <text x={cx} y={10} textAnchor="middle" fontSize={9} fill={COLORS.dim} fontWeight="700">N</text>
      <text x={size - 5} y={cy + 4} textAnchor="middle" fontSize={9} fill={COLORS.faint}>E</text>
      <text x={cx} y={size - 3} textAnchor="middle" fontSize={9} fill={COLORS.faint}>S</text>
      <text x={6} y={cy + 4} textAnchor="middle" fontSize={9} fill={COLORS.faint}>W</text>
      <g transform={`rotate(${directionDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 8} stroke="#ff6b6b" strokeWidth={2.5} strokeLinecap="round" />
        <polygon
          points={`${cx - 4},${cy - r + 12} ${cx + 4},${cy - r + 12} ${cx},${cy - r + 4}`}
          fill="#ff6b6b"
        />
        <circle cx={cx} cy={cy} r={2.5} fill="#ff6b6b" />
      </g>
    </svg>
  );
}

export default function WindCard({ wind, timestamp, segmentCount }: Props) {
  const dirText = `${compassPoint(wind.directionDeg)} (${Math.round(wind.directionDeg)}°)`;
  return (
    <div style={{ ...glass, padding: '13px 15px', minWidth: 224 }}>
      <div style={{ fontSize: 10.5, color: COLORS.faint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5, fontWeight: 600 }}>
        Copenhagen — Live
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <Compass directionDeg={wind.directionDeg} size={56} />
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.05, letterSpacing: -0.5 }}>
            {wind.speedMs.toFixed(1)}
            <span style={{ fontSize: 12, color: COLORS.dim, marginLeft: 5, fontWeight: 500 }}>m/s</span>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.dim }}>from {dirText}</div>
          {wind.gustMs !== undefined && (
            <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
              gusts {wind.gustMs.toFixed(1)} m/s
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 11, paddingTop: 9, borderTop: `1px solid ${COLORS.line}`, fontSize: 10, color: COLORS.faint }}>
        Canyon-modified across {segmentCount.toLocaleString()} street segments
        {timestamp && <div style={{ marginTop: 2 }}>updated {new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>}
      </div>
    </div>
  );
}
