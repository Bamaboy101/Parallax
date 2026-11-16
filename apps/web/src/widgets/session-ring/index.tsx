import { useEffect, useState } from 'react';
import '../../design/panels.css';
import { MARKETS, localTime, sessionState, sessionsOnClock } from './markets';

const TICK_MS = 30_000;
const DAY = 24 * 60;
const CENTER = 100;
const RADII = [84, 70, 56, 42];

/** Minute of the day → [x, y] on a circle, midnight at the top, clockwise. */
function coords(minute: number, radius: number): [number, number] {
  const angle = (minute / DAY) * 2 * Math.PI - Math.PI / 2;
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
}

/** The same point as an SVG path coordinate pair. */
function point(minute: number, radius: number): string {
  return coords(minute, radius)
    .map((value) => value.toFixed(2))
    .join(' ');
}

function arc(start: number, end: number, radius: number): string {
  const r = String(radius);
  if (end - start >= DAY) {
    // A full circle as two half arcs.
    const top = point(0, radius);
    return `M ${top} A ${r} ${r} 0 1 1 ${point(DAY / 2, radius)} A ${r} ${r} 0 1 1 ${top}`;
  }
  const large = end - start > DAY / 2 ? '1' : '0';
  return `M ${point(start, radius)} A ${r} ${r} 0 ${large} 1 ${point(end, radius)}`;
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
  return hours > 0 ? `${String(hours)}h ${String(rest)}m` : `${String(rest)}m`;
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

/** A 24-hour ring of which markets are open now, on the viewer's clock, with a hand at now. */
export default function SessionRing() {
  const now = useNow();
  const viewerOffset = -new Date(now).getTimezoneOffset();
  const viewerMinute =
    (((new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes() + viewerOffset) % DAY) +
      DAY) %
    DAY;
  const markets = MARKETS.map((market, index) => ({
    market,
    radius: RADII[index] ?? 30,
    state: sessionState(market, now),
    arcs: sessionsOnClock(market, now, viewerOffset),
    local: market.timeZone ? clock(localTime(now, market.timeZone).minute) : undefined,
  }));
  const [handX, handY] = coords(viewerMinute, 92);

  return (
    <div className="session-panel">
      <svg
        className="session-ring"
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Market sessions on your clock, now ${clock(viewerMinute)}: ${markets
          .map(({ market, state }) => `${market.name} ${state.open ? 'open' : 'closed'}`)
          .join(', ')}`}
      >
        {[0, 6, 12, 18].map((hour) => {
          const [x, y] = coords(hour * 60, 96);
          return (
            <text
              key={hour}
              x={x}
              y={y}
              className="session-hour"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {String(hour).padStart(2, '0')}
            </text>
          );
        })}
        {markets.map(({ market, radius, state, arcs }) => (
          <g key={market.id} className={state.open ? 'session-market is-open' : 'session-market'}>
            <circle cx={CENTER} cy={CENTER} r={radius} className="session-track" />
            {arcs.map(([start, end]) => (
              <path key={start} d={arc(start, end, radius)} className="session-arc" />
            ))}
          </g>
        ))}
        <line x1={CENTER} y1={CENTER} x2={handX} y2={handY} className="session-hand" />
        <circle cx={CENTER} cy={CENTER} r={3} className="session-pivot" />
      </svg>
      <ul className="session-list">
        {markets.map(({ market, state, local }) => (
          <li key={market.id} className={state.open ? 'is-open' : undefined}>
            <span className="session-dot" aria-hidden="true" />
            <span className="session-name">{market.name}</span>
            <span className="session-status">{state.open ? 'Open' : 'Closed'}</span>
            <span className="session-next">
              {state.minutesToChange === undefined
                ? 'always on'
                : `${state.open ? 'closes' : 'opens'} in ${duration(state.minutesToChange)}`}
            </span>
            <span className="session-local">{local ?? '24/7'}</span>
          </li>
        ))}
      </ul>
      <p className="panel-footnote">Regular sessions; exchange holidays are not shown.</p>
    </div>
  );
}
