import '../../design/panels.css';
import { useCursor } from '../../store/hooks';
import { useNow } from '../useNow';
import {
  formatDuration,
  localTime,
  MARKETS,
  sessionState,
  sessionsOnClock,
} from '../../store/sessions';

const TICK_MS = 30_000;
const DAY = 24 * 60;
const CENTER = 100;
/** One ring per market, outermost first; the core circle is r = 31. */
const RADII = [86, 79, 72, 65, 58, 51, 44, 37];

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

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const DIAL_TICKS = Array.from({ length: DAY / 5 }, (_, index) => {
  const minute = index * 5;
  const major = minute % 60 === 0;
  const [x1, y1] = coords(minute, major ? 89 : 91);
  const [x2, y2] = coords(minute, 93);
  return (
    <line
      key={minute}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={major ? 'session-tick is-hour' : 'session-tick'}
    />
  );
});

/** A local 24-hour clock with exchange-zone sessions and five-minute subdivisions. */
export default function SessionRing() {
  const liveNow = useNow(TICK_MS);
  const [cursor] = useCursor();
  const now = cursor ?? liveNow;
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
    <div className={cursor === null ? 'session-panel' : 'session-panel is-rewound'}>
      <svg
        className="session-ring"
        viewBox="-8 -8 216 216"
        role="img"
        aria-label={`Market sessions on your local clock${cursor === null ? '' : ', historical time'}, ${clock(viewerMinute)}: ${markets
          .map(({ market, state }) => `${market.name} ${state.open ? 'open' : 'closed'}`)
          .join(', ')}`}
      >
        <title>Regular exchange sessions · local 24-hour clock · five-minute marks</title>
        {DIAL_TICKS}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => {
          const [x, y] = coords(hour * 60, 101);
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
        {markets.map(({ market, radius, state, arcs }, index) => (
          <g key={market.id} className={state.open ? 'session-market is-open' : 'session-market'}>
            <title>
              {`${market.name}: ${
                market.sessions.length === 0
                  ? '24/7'
                  : market.sessions
                      .map(([open, close]) => `${clock(open)}–${clock(close)}`)
                      .join(', ')
              } ${market.timeZone ?? ''}; ${state.open ? 'open' : 'closed'}`}
            </title>
            <circle cx={CENTER} cy={CENTER} r={radius} className="session-track" />
            {arcs.map(([start, end]) => (
              <path key={start} d={arc(start, end, radius)} className="session-arc" />
            ))}
            <text x={CENTER + 5} y={CENTER - radius + 2} className="session-ring-index">
              {String(index + 1).padStart(2, '0')}
            </text>
          </g>
        ))}
        <line x1={CENTER} y1={CENTER} x2={handX} y2={handY} className="session-hand" />
        <circle cx={handX} cy={handY} r={2} className="session-hand-tip" />
        <circle cx={CENTER} cy={CENTER} r={31} className="session-core" />
        <text x={CENTER} y={99} textAnchor="middle" className="session-clock">
          {clock(viewerMinute)}
        </text>
        <text x={CENTER} y={110} textAnchor="middle" className="session-zone">
          {cursor === null ? 'LOCAL / 24H' : 'PAST / LOCAL'}
        </text>
      </svg>
      <ul className="session-list">
        {markets.map(({ market, state, local }, index) => (
          <li key={market.id} className={state.open ? 'is-open' : undefined}>
            <span className="session-dot" aria-hidden="true" />
            <span className="session-name">
              <span className="session-index">{String(index + 1).padStart(2, '0')}</span>
              {market.name}
            </span>
            <span className="session-status">{state.open ? 'Open' : 'Closed'}</span>
            <span className="session-next">
              {state.minutesToChange === undefined
                ? 'always on'
                : `${state.open ? 'closes' : 'opens'} in ${formatDuration(state.minutesToChange)}`}
            </span>
            <span className="session-local" title={market.timeZone ?? 'Continuous trading'}>
              {local ?? '24/7'}
            </span>
          </li>
        ))}
      </ul>
      <p className="panel-footnote">Regular hours · exchange-local times · holidays not shown</p>
    </div>
  );
}
