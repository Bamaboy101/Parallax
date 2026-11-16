import type { IDockviewPanelProps } from 'dockview-react';
import '../../design/market.css';
import '../../design/panels.css';
import { newYorkInstant, useCalendar, type Release } from '../../store/calendar';
import { useReportSources } from '../../store/panels';
import { useNow } from '../useNow';
import { RELEASE_INFO } from './meta';

const newYorkDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const localClock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];

function dayLabel(date: string, today: string, tomorrow: string): string {
  const [year, month, day] = parts(date);
  const named = dayFormat.format(Date.UTC(year, month - 1, day, 12));
  if (date === today) return `Today · ${named}`;
  if (date === tomorrow) return `Tomorrow · ${named}`;
  return named;
}

function ReleaseRow({ release, now }: { release: Release; now: number }) {
  const info = RELEASE_INFO[release.id];
  const at = info ? newYorkInstant(release.date, info.usual) : undefined;
  const past = at !== undefined && at <= now;
  return (
    <li
      className={past ? 'market-row calendar-columns is-past' : 'market-row calendar-columns'}
      title={past ? 'Usual release time has passed' : undefined}
    >
      <span className="calendar-time font-mono" title="The agency's usual time, New York">
        {info ? `${info.usual} ET` : '—'}
        {at !== undefined && <span className="derivs-muted">{localClock.format(at)} yours</span>}
      </span>
      <span className="calendar-release">
        <span className="calendar-name">{release.name}</span>
        {info && <span className="derivs-muted">{info.about}</span>}
      </span>
    </li>
  );
}

/** Upcoming major US data releases over the next 30 days, from FRED's release calendar. */
export default function Calendar({ api }: IDockviewPanelProps) {
  const calendar = useCalendar();
  const now = useNow(60_000);
  useReportSources(api.id, ['fred']);
  const today = newYorkDate.format(now);
  const tomorrow = newYorkDate.format(now + 86_400_000);
  const upcoming = calendar.releases.filter((release) => release.date >= today);
  const days = [...new Set(upcoming.map((release) => release.date))];

  return (
    <div className="market-panel calendar-panel">
      {calendar.state === 'loading' && <p className="panel-empty">Loading the calendar…</p>}
      {calendar.state === 'error' && (
        <p className="panel-empty">The calendar is unavailable right now ({calendar.error}).</p>
      )}
      {calendar.state === 'ready' && days.length === 0 && (
        <p className="panel-empty">No major releases scheduled in the next 30 days.</p>
      )}
      {days.map((date) => (
        <section key={date} aria-label={date}>
          <h3 className="markets-group">{dayLabel(date, today, tomorrow)}</h3>
          <ul>
            {upcoming
              .filter((release) => release.date === date)
              // In the order they come out: '08:30' sorts before '09:15'.
              .sort((a, b) =>
                (RELEASE_INFO[a.id]?.usual ?? '').localeCompare(RELEASE_INFO[b.id]?.usual ?? ''),
              )
              .map((release) => (
                <ReleaseRow key={`${String(release.id)}-${date}`} release={release} now={now} />
              ))}
          </ul>
        </section>
      ))}
      <p className="panel-footnote">
        Major US releases from FRED's release calendar, via the edge (cached 6 h). FRED lists dates
        only: times are each agency's usual time in New York, shown with yours. FOMC decisions are
        not FRED releases and are not listed.
      </p>
    </div>
  );
}
