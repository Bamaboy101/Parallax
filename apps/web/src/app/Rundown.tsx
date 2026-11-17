import type { ReactNode } from 'react';
import { Badge } from '../design/Badge';
import { badgeSeverity, formatNumber, type Freshness } from '../design/format';
import { changeWords, plainName } from '../design/plain';
import '../design/rundown.css';
import { requestSettings } from '../design/settingsRequest';
import { writeBrief, type BriefRef } from '../store/brief';
import { useCalendar } from '../store/calendar';
import { usePriceLine, usePriceSubscriptions } from '../store/hooks';
import { useKeyVault } from '../store/keys';
import { daysBefore, useFred } from '../store/macro';
import { useMovers, type Mover } from '../store/movers';
import { NEWS_REFRESH_MS, useNews } from '../store/news';
import { useFreshness } from '../store/panels';
import { usePredictionsFeed, usePredictionStore } from '../store/predictions/store';
import { usePrefs } from '../store/prefs';
import {
  biggestMoves,
  CRYPTO_IDS,
  dailyStat,
  DOLLAR_SERIES,
  GOLD_ID,
  OIL_SERIES,
  REGIONS,
  releasesForToday,
  RUNDOWN_IDS,
  topEvents,
  type DailyStat,
  type RegionPlan,
} from '../store/rundown';
import { formatDuration, market, sessionState } from '../store/sessions';
import { instrument, instruments, type Instrument } from '../store/symbols';
import { OGDL_URL, TWSE_ATTRIBUTION, useTaiex } from '../store/taiex';
import { PROXY_LABEL } from '../widgets/regionBoards';
import { useNow } from '../widgets/useNow';

/** Where each brief sentence's figures are shown (E4). */
const BRIEF_SOURCES: Readonly<Record<BriefRef, string>> = {
  world: 'World markets',
  moves: 'Biggest moves',
  crypto: 'Crypto',
  anchors: 'The dollar, oil and gold',
  events: 'Events',
  calendar: 'Calendar',
};

const ITEMS = instruments([...RUNDOWN_IDS]);
const HEADLINES = 5;

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

/** Big-number decimals: FX to four places (two against the yen), prices as the catalogue says. */
const decimalsOf = (item: Instrument) =>
  item.kind === 'fx' ? Math.min(item.decimals, 4) : item.decimals;

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const asDate = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** The worst of a section's feeds, as one truth badge (like a panel header's). */
function SectionBadge({ sources, fallback }: { sources: readonly string[]; fallback: string }) {
  const freshness = useFreshness(sources);
  if (sources.length === 0) return <Badge freshness={{ kind: 'connecting' }} source={fallback} />;
  let worst = 0;
  freshness.forEach((value, index) => {
    const current = freshness[worst];
    if (current && badgeSeverity(value) > badgeSeverity(current)) worst = index;
  });
  return (
    <Badge
      freshness={freshness[worst] ?? { kind: 'connecting' }}
      source={sources[worst] ?? fallback}
    />
  );
}

function Section({
  id,
  title,
  badge,
  children,
  className = '',
}: {
  id: string;
  title: string;
  badge: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rundown-section ${className}`} aria-labelledby={`rundown-${id}`}>
      <header className="rundown-section-head">
        <h2 id={`rundown-${id}`}>{title}</h2>
        {badge}
      </header>
      {children}
    </section>
  );
}

/** A change as a signed number in the price colours, with the words for screen readers. */
function Change({ value, decimals = 2 }: { value: number | undefined; decimals?: number }) {
  if (value === undefined) return <span className="rundown-change text-muted">—</span>;
  return (
    <span
      className="rundown-change"
      data-tone={toneOf(value)}
      aria-label={changeWords(value, decimals)}
    >
      {formatNumber(value, decimals, true)}%
    </span>
  );
}

/**
 * One instrument as a big number: its plain name, price and change. It shows the page's price
 * snapshot (refreshed with the moves, every 10 s), so the daily brief quotes exactly what is here.
 * Before the first live trade (gold's token trades rarely) it shows the last hourly close, dimmed
 * and said so.
 */
function Figure({
  item,
  mover,
  note,
}: {
  item: Instrument;
  mover: Mover | undefined;
  note?: string;
}) {
  const line = usePriceLine(item);
  const fromHistory = !mover && line.price !== undefined && !line.live;
  return (
    <div className="rundown-figure" title={item.label} data-history={fromHistory || undefined}>
      <span className="rundown-figure-name">{plainName(item)}</span>
      <span className="rundown-figure-value">
        {formatNumber(mover ? mover.price : line.price, decimalsOf(item))}
      </span>
      <Change value={mover ? mover.changePct : line.changePct} />
      {(note ?? fromHistory) && (
        <span className="rundown-figure-note">
          {[note, fromHistory ? 'last hourly close' : undefined].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
  );
}

function Daily({
  name,
  stat,
  unit,
  note,
}: {
  name: string;
  stat: DailyStat | undefined;
  unit: string;
  note: string;
}) {
  return (
    <div className="rundown-figure">
      <span className="rundown-figure-name">{name}</span>
      <span className="rundown-figure-value">{formatNumber(stat?.value, 2)}</span>
      <Change value={stat?.changePct} />
      <span className="rundown-figure-note">
        {unit}
        {stat ? `, ${shortDate.format(asDate(stat.asOf))}` : ''} · {note}
      </span>
    </div>
  );
}

function RegionCard({
  region,
  byId,
  now,
  hasStockKey,
}: {
  region: RegionPlan;
  byId: ReadonlyMap<string, Mover>;
  now: number;
  hasStockKey: boolean;
}) {
  const taiex = useTaiex();
  const ids = [...region.currencies, ...region.funds.map(([id]) => id)];
  const sources = ids.flatMap((id) => {
    const source = byId.get(id)?.source;
    return source ? [source] : [];
  });
  return (
    <article className="rundown-region" aria-labelledby={`region-${region.id}`}>
      <header className="rundown-section-head">
        <h3 id={`region-${region.id}`}>{region.title}</h3>
        <SectionBadge sources={region.taiex ? [...sources, 'twse'] : sources} fallback="kraken" />
      </header>
      <ul className="rundown-sessions">
        {region.markets.map((id) => {
          const place = market(id);
          if (!place) return null;
          const state = sessionState(place, now);
          const when =
            state.minutesToChange === undefined
              ? ''
              : `${state.open ? 'closes' : 'opens'} in ${formatDuration(state.minutesToChange)}`;
          return (
            <li key={id} data-open={state.open || undefined}>
              <span className="rundown-session-dot" aria-hidden="true" />
              <span>{place.name}</span>
              <span className="rundown-session-state">
                {state.open ? 'open' : 'closed'}
                {when && ` · ${when}`}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="rundown-rows">
        {instruments([...region.currencies]).map((item) => (
          <li key={item.id} title={item.label}>
            <span>{plainName(item)}</span>
            <span className="rundown-row-value">
              {formatNumber(byId.get(item.id)?.price, decimalsOf(item))}
            </span>
            <Change value={byId.get(item.id)?.changePct} />
          </li>
        ))}
        {hasStockKey
          ? region.funds.map(([id, label]) => {
              const item = instrument(id);
              if (!item) return null;
              return (
                <li key={id} title={`${item.label}: ${item.name}, ${PROXY_LABEL}`}>
                  <span>
                    {label}
                    <span className="rundown-row-note">fund {item.label}, US hours only</span>
                  </span>
                  <span className="rundown-row-value">{formatNumber(byId.get(id)?.price, 2)}</span>
                  <Change value={byId.get(id)?.changePct} />
                </li>
              );
            })
          : null}
        {region.taiex && (
          <li title="Official close from the Taiwan Stock Exchange's open data">
            <span>
              Taiwan stocks (TAIEX)
              <span className="rundown-row-note">
                official close
                {taiex.latest ? `, ${shortDate.format(asDate(taiex.latest.date))}` : ''}
              </span>
            </span>
            <span className="rundown-row-value">{formatNumber(taiex.latest?.close, 2)}</span>
            <Change value={taiex.changePct} />
          </li>
        )}
      </ul>
      {!hasStockKey && (
        <p className="rundown-key-note">
          Stock prices need a free key.{' '}
          <button type="button" className="rundown-link" onClick={requestSettings}>
            Add one in Settings
          </button>
        </p>
      )}
    </article>
  );
}

/**
 * E1: the home page. What is happening in markets right now, in plain words and big numbers,
 * every figure with its truth badge, all of it without a key.
 */
export function Rundown() {
  const now = useNow(10_000);
  usePriceSubscriptions(ITEMS);
  usePredictionsFeed();
  const movers = useMovers(now);
  const byId = new Map(movers.universe.map((mover) => [mover.item.id, mover]));
  const keys = useKeyVault((state) => state.keys);
  const hasStockKey = 'alpaca' in keys || 'finnhub' in keys;
  const today = new Intl.DateTimeFormat('en-CA').format(now);
  const fred = useFred([DOLLAR_SERIES, OIL_SERIES], daysBefore(today, 14));
  const fredFreshness: Freshness =
    fred.state === 'ready'
      ? { kind: 'eod' }
      : fred.state === 'error'
        ? { kind: 'offline' }
        : { kind: 'connecting' };
  const calendar = useCalendar();
  const news = useNews('');
  const newsFreshness: Freshness =
    news.state === 'ready'
      ? { kind: 'polled', everyMs: NEWS_REFRESH_MS }
      : news.state === 'error'
        ? { kind: 'offline' }
        : { kind: 'connecting' };
  const predictions = usePredictionStore();
  const events = topEvents(predictions.events, predictions.midpoints, now);
  const moves = biggestMoves(movers.universe);
  const day = releasesForToday(calendar.releases, now);
  const gold = instrument(GOLD_ID);
  const sourcesOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const source = byId.get(id)?.source;
      return source ? [source] : [];
    });
  const setView = usePrefs((state) => state.setView);
  const brief = writeBrief({
    exchanges: REGIONS.flatMap((region) =>
      region.markets.flatMap((id) => {
        const place = market(id);
        return place ? [{ name: place.name, ...sessionState(place, now) }] : [];
      }),
    ),
    moves,
    bitcoin: byId.get('BTC-USD'),
    dollar: dailyStat(fred.series[DOLLAR_SERIES]),
    oil: dailyStat(fred.series[OIL_SERIES]),
    events,
    calendar: day,
  });

  return (
    <div className="rundown" id="rundown">
      <div className="rundown-intro">
        <div data-tour="rundown">
          <h1 id="rundown-title">What&apos;s happening in markets right now</h1>
          <p className="rundown-date">
            {dayFormat.format(now)} · {timeFormat.format(now)}
          </p>
        </div>
        <button
          type="button"
          className="rundown-cockpit"
          data-tour="cockpit"
          onClick={() => {
            setView('cockpit');
          }}
        >
          Open the full cockpit
        </button>
      </div>

      <section className="rundown-brief" aria-labelledby="rundown-brief">
        <header className="rundown-section-head">
          <h2 id="rundown-brief">Daily brief</h2>
          <span className="rundown-section-hint">
            written by rules from the figures below, no AI
          </span>
        </header>
        {brief.length === 0 ? (
          <p className="rundown-empty">Waiting for the first figures…</p>
        ) : (
          <ul className="rundown-brief-list">
            {brief.map((sentence) => (
              <li key={sentence.text}>
                {sentence.text}{' '}
                {sentence.refs.map((ref) => (
                  <a key={ref} className="rundown-brief-ref" href={`#rundown-${ref}`}>
                    {BRIEF_SOURCES[ref]}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section
        id="world"
        title="World markets"
        className="rundown-world"
        badge={<span className="rundown-section-hint">by region</span>}
      >
        <div className="rundown-regions">
          {REGIONS.map((region) => (
            <RegionCard
              key={region.id}
              region={region}
              byId={byId}
              now={now}
              hasStockKey={hasStockKey}
            />
          ))}
        </div>
      </Section>

      <Section
        id="moves"
        title="Biggest moves"
        badge={<SectionBadge sources={moves.map((mover) => mover.source)} fallback="coinbase" />}
      >
        {moves.length === 0 ? (
          <p className="rundown-empty">Waiting for the first prices…</p>
        ) : (
          <ol className="rundown-moves">
            {moves.map((mover) => (
              <li key={mover.item.id} title={mover.item.label}>
                <span>{plainName(mover.item)}</span>
                <Change value={mover.changePct} />
                <span className="rundown-row-value">
                  {formatNumber(mover.price, decimalsOf(mover.item))}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="rundown-footnote">
          Over 24 hours for crypto and currencies; since the last close for stock funds.
        </p>
      </Section>

      <Section
        id="crypto"
        title="Crypto"
        badge={<SectionBadge sources={sourcesOf(CRYPTO_IDS)} fallback="coinbase" />}
      >
        <div className="rundown-figures">
          {instruments([...CRYPTO_IDS]).map((item) => (
            <Figure key={item.id} item={item} mover={byId.get(item.id)} />
          ))}
        </div>
      </Section>

      <Section
        id="anchors"
        title="The dollar, oil and gold"
        badge={
          <span className="rundown-badges">
            <Badge freshness={fredFreshness} source="fred" />
            <SectionBadge sources={sourcesOf([GOLD_ID])} fallback="coinbase" />
          </span>
        }
      >
        <div className="rundown-figures">
          <Daily
            name="The dollar"
            stat={dailyStat(fred.series[DOLLAR_SERIES])}
            unit="index"
            note="Fed broad dollar index"
          />
          <Daily
            name="Oil"
            stat={dailyStat(fred.series[OIL_SERIES])}
            unit="$ a barrel"
            note="US crude (WTI)"
          />
          {gold && (
            <Figure
              item={gold}
              mover={byId.get(GOLD_ID)}
              note="$ an ounce, via the PAX Gold token"
            />
          )}
        </div>
      </Section>

      <Section
        id="events"
        title="Events that could move markets"
        badge={<SectionBadge sources={['polymarket']} fallback="polymarket" />}
      >
        {events.length === 0 ? (
          <p className="rundown-empty">Loading the odds…</p>
        ) : (
          <ol className="rundown-events">
            {events.map(({ event, outcome, odds, dayChange }) => (
              <li key={event.id}>
                <span className="rundown-event-odds">{formatNumber(odds * 100, 0)}%</span>
                <span className="rundown-event-text">
                  <span>{event.title}</span>
                  <span className="rundown-row-note">
                    {outcome.label === 'Yes'
                      ? 'chance it happens'
                      : `most likely: ${outcome.label}`}
                    {dayChange !== null && Math.round(dayChange * 100) !== 0
                      ? ` · ${formatNumber(dayChange * 100, 0, true)} points today`
                      : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="rundown-footnote">
          Market odds, not forecasts: what people pay on Polymarket for each outcome.
        </p>
      </Section>

      <Section
        id="calendar"
        title="Today's calendar"
        badge={<SectionBadge sources={['fred']} fallback="fred" />}
      >
        {day === undefined ? (
          <p className="rundown-empty">
            {calendar.state === 'loading' ? 'Loading the calendar…' : 'No US releases scheduled.'}
          </p>
        ) : (
          <>
            {!day.today && (
              <p className="rundown-section-hint">
                Nothing scheduled today. Next: {dayFormat.format(asDate(day.date))}
              </p>
            )}
            <ul className="rundown-list">
              {day.releases.map((release) => (
                <li key={release.id}>{release.name}</li>
              ))}
            </ul>
          </>
        )}
        <p className="rundown-footnote">Major US economic releases, from FRED&apos;s calendar.</p>
      </Section>

      <Section
        id="headlines"
        title="Latest headlines"
        badge={<Badge freshness={newsFreshness} source="publisher RSS" />}
      >
        {news.items.length === 0 ? (
          <p className="rundown-empty">
            {news.state === 'error' ? 'Headlines are offline.' : 'Loading headlines…'}
          </p>
        ) : (
          <ul className="rundown-list rundown-headlines">
            {news.items.slice(0, HEADLINES).map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <span className="rundown-row-note">
                  {item.source}
                  {item.published > 0 ? ` · ${timeFormat.format(item.published)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="rundown-credits">
        <p>
          Market data as delivered by its public sources; not investment advice. The dollar: Board
          of Governors of the Federal Reserve System, Nominal Broad U.S. Dollar Index; oil: U.S.
          Energy Information Administration, WTI spot price; both retrieved from FRED, Federal
          Reserve Bank of St. Louis. Odds: Polymarket.
        </p>
        <p>
          {TWSE_ATTRIBUTION}{' '}
          <a href={OGDL_URL} target="_blank" rel="noreferrer">
            {OGDL_URL}
          </a>
        </p>
      </footer>
    </div>
  );
}
