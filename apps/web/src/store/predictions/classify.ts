import { isObject, type Json } from '../../feeds/adapters/parse';

/**
 * M1 curation: which Polymarket events can move markets, and how to group and link them.
 * Pure functions over Gamma's event JSON, so the worker and the tests share them.
 */

export type Theme =
  'central-banks' | 'macro-data' | 'elections' | 'geopolitics' | 'trade-energy' | 'fiscal';

export const THEMES: readonly { id: Theme; title: string }[] = [
  { id: 'central-banks', title: 'Central banks' },
  { id: 'macro-data', title: 'Inflation, jobs and growth' },
  { id: 'elections', title: 'Elections and leaders' },
  { id: 'geopolitics', title: 'Conflict and sanctions' },
  { id: 'trade-energy', title: 'Trade, tariffs and oil' },
  { id: 'fiscal', title: 'Shutdowns, debt and defaults' },
];

export type Region =
  'us' | 'americas' | 'europe' | 'uk' | 'middle-east' | 'asia-pacific' | 'global';

export const REGIONS: readonly { id: Region; title: string }[] = [
  { id: 'us', title: 'United States' },
  { id: 'americas', title: 'Americas' },
  { id: 'europe', title: 'Europe' },
  { id: 'uk', title: 'United Kingdom' },
  { id: 'middle-east', title: 'Middle East' },
  { id: 'asia-pacific', title: 'Asia-Pacific' },
  { id: 'global', title: 'Global' },
];

/** What an event can move: a catalogue instrument, or the US 2-year yield from FRED. */
export type AssetLink = { kind: 'instrument'; id: string } | { kind: 'yield'; series: 'DGS2' };

const asset = (id: string): AssetLink => ({ kind: 'instrument', id });
const US_2Y: AssetLink = { kind: 'yield', series: 'DGS2' };

export interface Outcome {
  /** 'Yes' for a single question; the option name ('25 bps cut') in a multi-outcome event. */
  label: string;
  tokenId: string;
  /** Gamma's price for the outcome when the event list was fetched, 0 to 1. */
  price: number;
  /** Change over 24 hours as Gamma reported it, in price units (0.05 = 5 points), or null. */
  dayChange: number | null;
  lastTrade: number | null;
  /** Spread over 10 cents: Polymarket then shows the last trade instead of the midpoint. */
  wideSpread: boolean;
  /** When this outcome's own market ends, epoch ms: a dated rung of a "by…?" ladder. */
  ends: number | null;
}

export interface PredictionEvent {
  id: string;
  slug: string;
  title: string;
  theme: Theme;
  region: Region;
  /** Resolution date, epoch ms, or null when Gamma gives none. */
  endDate: number | null;
  /** USD traded in the last 24 hours, and in total. */
  volume24h: number;
  volume: number;
  /** Most likely first. */
  outcomes: Outcome[];
  assets: AssetLink[];
}

/** Polymarket's display rule: the midpoint, or the last trade once the spread is over 10 cents. */
export const WIDE_SPREAD = 0.1;
/** Outcomes kept per event; the panel shows the top three. */
const MAX_OUTCOMES = 8;

/** Not market-moving: sports, entertainment, crypto prices, price targets and novelty markets. */
const EXCLUDED_TAGS = new Set([
  'sports',
  'esports',
  'nba',
  'nfl',
  'soccer',
  'crypto',
  'crypto-prices',
  'bitcoin',
  'ethereum',
  'pop-culture',
  'culture',
  'entertainment',
  'music',
  'movies',
  'awards',
  'celebrities',
  'tweets-markets',
  'mentions',
  'tech',
  'big-tech',
  'ai',
  'science',
  'aliens',
  'hit-price',
  'finance-updown',
  'pyth-finance',
  'ukraine-map',
  'cabinet-shakeup',
  'mayoral-elections',
  'parlays',
  'derivatives',
  'weather',
  'outage',
]);

const EXCLUDED_TITLE =
  /#\s*(tweets|posts)|\btweets?\b|truth social|shake hands|seen together|full lid|\bmeets?\b|speak to|\baliens?\b|\bufo\b|arrested|impeached|press secretary|largest company|how (high|low) will|what will .+ hit|all[- ]time high|\bmayor(al)?\b|local elections|house election winner|happiness/i;

type Bank = 'fed' | 'ecb' | 'boe' | 'boj' | 'rba' | 'pboc';

/** Only these six central banks are in scope. */
const BANKS: readonly {
  id: Bank;
  tags: string[];
  title: RegExp;
  region: Region;
  assets: AssetLink[];
}[] = [
  {
    id: 'fed',
    tags: ['fed', 'fed-rates', 'fomc'],
    title: /\b(fed|fomc|federal reserve)\b/i,
    region: 'us',
    assets: [US_2Y, asset('PAXG-USD'), asset('UUP')],
  },
  {
    id: 'ecb',
    tags: ['ecb'],
    title: /\becb\b|european central bank/i,
    region: 'europe',
    assets: [asset('EUR-USD'), asset('EWG')],
  },
  {
    id: 'boe',
    tags: ['boe', 'bank-of-england'],
    title: /bank of england|\bboe\b/i,
    region: 'uk',
    assets: [asset('GBP-USD'), asset('EWU')],
  },
  {
    id: 'boj',
    tags: ['boj', 'bank-of-japan'],
    title: /bank of japan|\bboj\b/i,
    region: 'asia-pacific',
    assets: [asset('USD-JPY'), asset('EWJ')],
  },
  {
    id: 'rba',
    tags: ['rba'],
    title: /reserve bank of australia|\brba\b/i,
    region: 'asia-pacific',
    assets: [asset('AUD-USD')],
  },
  {
    id: 'pboc',
    tags: ['pboc'],
    title: /people'?s bank of china|\bpboc\b|loan prime rate/i,
    region: 'asia-pacific',
    assets: [asset('FXI'), asset('AUD-USD')],
  },
];

/** Rate-decision tags: an event carrying one for a bank outside the six is left out. */
const RATE_TAGS = ['fed-rates', 'global-rates', 'interest-rates', 'interest-rate', 'fomc'];

/**
 * Places, in the order they are tried: a Middle East flashpoint involving the US is filed under
 * the Middle East, a trade deal with Canada under the Americas. `major` marks the economies whose
 * elections and leadership changes are in scope.
 */
interface Place {
  words: RegExp;
  region: Region;
  major: boolean;
  /** Assets for this country's elections, when they differ from its region's. */
  assets?: AssetLink[];
}

const PLACES: readonly Place[] = [
  { words: /\b(israel|israeli|netanyahu)\b/i, region: 'middle-east', major: true },
  {
    words:
      /\b(iran|iranian|khamenei|hormuz|houthis?|yemen|gaza|hamas|lebanon|hezbollah|syria|iraq|qatar)\b/i,
    region: 'middle-east',
    major: false,
  },
  { words: /\b(saudi|uae|mbs)\b/i, region: 'middle-east', major: true },
  { words: /\b(uk|u\.k\.|britain|british|england|starmer|labour)\b/i, region: 'uk', major: true },
  {
    words: /\b(russia|russian|putin|ukraine|ukrainian|zelensk(y|yy)|kyiv|nato)\b/i,
    region: 'europe',
    major: true,
  },
  { words: /\b(france|french|macron)\b/i, region: 'europe', major: true },
  { words: /\b(germany|german|merz)\b/i, region: 'europe', major: true },
  { words: /\b(italy|italian|meloni)\b/i, region: 'europe', major: true },
  { words: /\b(spain|spanish|s[aá]nchez)\b/i, region: 'europe', major: true },
  {
    words:
      /\b(netherlands|dutch|sweden|swedish|poland|polish|switzerland|swiss|belgium|norway|eu|european union|europe)\b/i,
    region: 'europe',
    major: true,
  },
  {
    words: /\b(japan|japanese|takaichi)\b/i,
    region: 'asia-pacific',
    major: true,
    assets: [asset('USD-JPY'), asset('EWJ')],
  },
  {
    words: /\b(china|chinese|xi|beijing|taiwan|taiwanese)\b/i,
    region: 'asia-pacific',
    major: true,
    assets: [asset('FXI')],
  },
  {
    words: /\b(india|indian|modi)\b/i,
    region: 'asia-pacific',
    major: true,
    assets: [asset('INDA')],
  },
  {
    words: /\b(south korea|korean|seoul)\b/i,
    region: 'asia-pacific',
    major: true,
    assets: [asset('EEM')],
  },
  {
    words: /\b(australia|australian|albanese)\b/i,
    region: 'asia-pacific',
    major: true,
    assets: [asset('AUD-USD')],
  },
  { words: /\b(north korea|kim jong)\b/i, region: 'asia-pacific', major: false },
  {
    words: /\b(canada|canadian|carney)\b/i,
    region: 'americas',
    major: true,
    assets: [asset('USD-CAD')],
  },
  {
    words: /\b(mexico|mexican|brazil|brazilian|argentina|argentine|milei)\b/i,
    region: 'americas',
    major: true,
    assets: [asset('EEM')],
  },
  { words: /\b(venezuela|maduro|colombia|chile)\b/i, region: 'americas', major: false },
  {
    words:
      /\b(us|u\.s\.|united states|american|fed|fomc|senate|congress|white house|republican|democratic|presidential|trump)\b/i,
    region: 'us',
    major: true,
  },
];

const has = (tags: readonly string[], wanted: readonly string[]) =>
  wanted.some((tag) => tags.includes(tag));

const textOf = (title: string, tags: readonly string[]) =>
  `${title} ${tags.join(' ').replaceAll('-', ' ')}`;

/** The first place named in the title, else in the tags. */
function placeOf(title: string, tags: readonly string[]): Place | undefined {
  return (
    PLACES.find((place) => place.words.test(title)) ??
    PLACES.find((place) => place.words.test(tags.join(' ').replaceAll('-', ' ')))
  );
}

function bankOf(title: string, tags: readonly string[]): (typeof BANKS)[number] | undefined {
  return BANKS.find((bank) => has(tags, bank.tags) || bank.title.test(title));
}

const OIL = /\b(opec|oil|crude|hormuz|blockade|tanker|diesel|pipeline|bab el[- ]mandeb)\b/i;

function themeOf(
  title: string,
  tags: readonly string[],
  bank: (typeof BANKS)[number] | undefined,
): Theme | null {
  const text = textOf(title, tags);
  const rateEvent =
    has(tags, RATE_TAGS) || /\b(decision|rate (cut|hike)|bps|interest rate)\b/i.test(title);
  if (bank && rateEvent) return 'central-banks';
  if (rateEvent && !bank && has(tags, RATE_TAGS)) return null; // another central bank: out of scope
  if (
    has(tags, [
      'government-shutdown',
      'gov-shutdown',
      'debt-ceiling',
      'debt-limit',
      'sovereign-default',
    ]) ||
    /\bshutdown\b|debt (ceiling|limit)|\bdefaults?\b/i.test(title)
  )
    return 'fiscal';
  if (
    has(tags, [
      'inflation',
      'cpi',
      'us-cpi',
      'cpi-release',
      'jobs',
      'jolts',
      'labor',
      'unemployment',
      'nfp',
      'payrolls',
      'gdp',
      'recession',
      'macro-indicators',
    ]) ||
    /\b(cpi|inflation|unemployment|payrolls|jobs report|jolts|gdp|recession)\b/i.test(title)
  )
    return 'macro-data';
  if (
    has(tags, [
      'tariffs',
      'trade',
      'trade-war',
      'trade-deal',
      'opec',
      'strait-of-hormuz',
      'hormuz',
    ]) ||
    /\btariffs?\b|trade (deal|war|agreement)/i.test(title) ||
    OIL.test(title)
  )
    return 'trade-energy';
  if (
    has(tags, [
      'elections',
      'world-elections',
      'global-elections',
      'main-election',
      'us-presidential-election',
      'midterms',
      'senate-elections',
      'primaries',
    ]) ||
    /\belection\b|prime minister|chancellor|\bpresident\b|leader (end|out)|out as (president|prime minister)/i.test(
      title,
    )
  )
    return 'elections';
  if (
    has(tags, [
      'geopolitics',
      'military-strikes',
      'military-action',
      'ukraine',
      'ukraine-peace-deal',
      'diplomacy-ceasefire',
      'sanctions',
      'nato',
      'israel-x-iran',
      'north-korea',
      'houthis',
      'war',
    ]) ||
    /\b(ceasefire|invade|invasion|war|strikes?|sanctions?|nuclear|military|regime)\b/i.test(text)
  )
    return 'geopolitics';
  return null;
}

function assetsOf(
  theme: Theme,
  region: Region,
  title: string,
  bank: (typeof BANKS)[number] | undefined,
  place: Place | undefined,
): AssetLink[] {
  if (theme === 'central-banks' && bank) return bank.assets;
  if (theme === 'trade-energy' && OIL.test(title))
    return [asset('USO'), asset('XLE'), asset('PAXG-USD')];
  if (theme === 'elections' && place?.assets) return place.assets;
  switch (region) {
    case 'us':
      if (theme === 'elections') return [asset('SPY'), asset('UUP')];
      if (theme === 'trade-energy') return [asset('UUP'), asset('SPY')];
      return [US_2Y, asset('PAXG-USD'), asset('UUP')];
    case 'uk':
      return [asset('GBP-USD'), asset('EWU')];
    case 'europe':
      return theme === 'geopolitics'
        ? [asset('PAXG-USD'), asset('UNG'), asset('EUR-USD')]
        : [asset('EUR-USD'), asset('EWG')];
    case 'middle-east':
      return [asset('USO'), asset('PAXG-USD')];
    case 'asia-pacific':
      return place?.assets
        ? [...place.assets, asset('PAXG-USD')]
        : [asset('FXI'), asset('PAXG-USD')];
    case 'americas':
      return place?.assets ?? [asset('EEM'), asset('UUP')];
    case 'global':
      return [asset('PAXG-USD'), asset('UUP')];
  }
}

/** Gamma sends some arrays as JSON strings: '["Yes", "No"]'. */
function jsonList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberOr(value: unknown, fallback: number | null): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
}

/** One Gamma market as outcomes: its Yes side, or every side when they are not Yes/No. */
function outcomesOf(market: Json, single: boolean): Outcome[] {
  if (market.active === false || market.closed === true) return [];
  const names = jsonList(market.outcomes).map(String);
  const prices = jsonList(market.outcomePrices).map((price) => numberOr(price, null));
  const tokens = jsonList(market.clobTokenIds).map(String);
  const dayChange = numberOr(market.oneDayPriceChange, null);
  const lastTrade = numberOr(market.lastTradePrice, null);
  const endsAt = typeof market.endDate === 'string' ? Date.parse(market.endDate) : Number.NaN;
  const ends = Number.isNaN(endsAt) ? null : endsAt;
  const spread = numberOr(market.spread, null);
  const wideSpread = spread !== null && spread > WIDE_SPREAD;
  const group = typeof market.groupItemTitle === 'string' ? market.groupItemTitle.trim() : '';
  const yesNo = names.length === 2 && names[0] === 'Yes' && names[1] === 'No';
  const sides = yesNo ? [0] : names.map((_, index) => index);
  return sides.flatMap((index) => {
    const price = prices[index];
    const tokenId = tokens[index];
    if (price === null || price === undefined || tokenId === undefined) return [];
    const label = yesNo ? (single || group === '' ? 'Yes' : group) : (names[index] ?? '');
    // Gamma's 24 h change is for the first side; a two-sided market's other side moves opposite.
    const change = dayChange === null ? null : index === 0 ? dayChange : -dayChange;
    return [
      {
        label,
        tokenId,
        price,
        dayChange: change,
        lastTrade: index === 0 ? lastTrade : null,
        wideSpread: index === 0 && wideSpread,
        ends,
      },
    ];
  });
}

/** A ladder rung's label: 'November 30', 'December 31, 2027'. */
const DATE_LABEL =
  /^(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(, \d{4})?$/i;

/** The outcomes still open at `now`: a ladder rung whose date has passed waits for resolution. */
export const openOutcomes = (event: PredictionEvent, now: number): Outcome[] =>
  event.outcomes.filter((outcome) => outcome.ends === null || outcome.ends > now);

/** One Gamma event, or null when it is out of scope or unreadable. */
export function classifyEvent(raw: unknown): PredictionEvent | null {
  if (!isObject(raw) || typeof raw.title !== 'string' || !Array.isArray(raw.markets)) return null;
  const title = raw.title;
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).flatMap((tag) =>
    isObject(tag) && typeof tag.slug === 'string' ? [tag.slug.toLowerCase()] : [],
  );
  if (tags.some((tag) => EXCLUDED_TAGS.has(tag)) || EXCLUDED_TITLE.test(title)) return null;

  const bank = bankOf(title, tags);
  const theme = themeOf(title, tags, bank);
  if (theme === null) return null;
  const place = theme === 'central-banks' ? undefined : placeOf(title, tags);
  if (theme === 'elections' && !place?.major) return null;
  // Macro releases and fiscal fights without a country name on Polymarket are American.
  const region: Region =
    theme === 'central-banks' && bank
      ? bank.region
      : (place?.region ?? (theme === 'macro-data' || theme === 'fiscal' ? 'us' : 'global'));

  const markets = raw.markets.filter(isObject);
  const all = markets.flatMap((market) => outcomesOf(market, markets.length === 1));
  // A "by…?" ladder (one market per date) reads in date order; anything else, most likely first.
  const ladder =
    all.length > 1 &&
    all.every((outcome) => outcome.ends !== null && DATE_LABEL.test(outcome.label));
  const outcomes = (
    ladder
      ? all.sort((a, b) => (a.ends ?? 0) - (b.ends ?? 0))
      : all.sort((a, b) => b.price - a.price)
  ).slice(0, MAX_OUTCOMES);
  if (outcomes.length === 0) return null;

  const endDate = typeof raw.endDate === 'string' ? Date.parse(raw.endDate) : Number.NaN;
  return {
    id: String(raw.id),
    slug: typeof raw.slug === 'string' ? raw.slug : String(raw.id),
    title,
    theme,
    region,
    endDate: Number.isNaN(endDate) ? null : endDate,
    volume24h: numberOr(raw.volume24hr, 0) ?? 0,
    volume: numberOr(raw.volume, 0) ?? 0,
    outcomes,
    assets: assetsOf(theme, region, title, bank, place),
  };
}

/** A Gamma `/events` page → in-scope events; unreadable entries are skipped. */
export function classifyEvents(raw: unknown): PredictionEvent[] {
  return Array.isArray(raw) ? raw.flatMap((entry) => classifyEvent(entry) ?? []) : [];
}

/**
 * The odds shown for an outcome: the live midpoint when there is one, Gamma's price otherwise,
 * and the last trade when the spread is wide (Polymarket's own display rule).
 */
export function oddsOf(outcome: Outcome, midpoint: number | undefined): number {
  if (outcome.wideSpread && outcome.lastTrade !== null) return outcome.lastTrade;
  return midpoint ?? outcome.price;
}

/** Change over 24 hours in points (0.05 = +5), from Gamma's figure and the latest odds. */
export function dayChangeOf(outcome: Outcome, odds: number): number | null {
  return outcome.dayChange === null ? null : odds - (outcome.price - outcome.dayChange);
}

export const eventUrl = (event: Pick<PredictionEvent, 'slug'>): string =>
  `https://polymarket.com/event/${encodeURIComponent(event.slug)}`;
