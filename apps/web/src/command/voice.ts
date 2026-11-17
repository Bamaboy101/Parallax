import { INSTRUMENTS } from '../store/symbols';
import { meta as news } from '../widgets/news/meta';
import { meta as odds } from '../widgets/predictions/meta';

/** Free-text searches keep the spoken name: "news Tesla" finds more headlines than "news TSLA". */
const SEARCH_WORDS = new Set([...news.aliases, ...odds.aliases]);

/**
 * F6 voice commands: what the browser's speech recognition heard, turned into the words the
 * command bar already understands. Speech gives "Bitcoin chart one hour" or "alert Ether below
 * 1,800"; the bar wants "btc chart 1h" and "alert eth below 1800". Nothing here runs a command.
 */

/** Spoken names the catalogue's tickers go by: its crypto and company names, plus a few aliases. */
const SPOKEN_NAMES: ReadonlyMap<string, string> = new Map([
  ...INSTRUMENTS.filter(
    (item) =>
      (item.kind === 'crypto' || item.kind === 'equity') &&
      !/\b(ETF|SPDR|Trust|Fund)\b/.test(item.name) &&
      item.name.toLowerCase() !== item.base.toLowerCase(),
  ).map((item) => [item.name.toLowerCase(), item.base.toLowerCase()] as const),
  ['ethereum', 'eth'],
  ['google', 'googl'],
  ['nvidia', 'nvda'],
  ['gold', 'paxg'],
]);

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  a: '1',
  an: '1',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  twelve: '12',
  fifteen: '15',
  twenty: '20',
  thirty: '30',
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest names first, so "pax gold" wins over "gold". */
const NAME_PATTERN = new RegExp(
  `\\b(${[...SPOKEN_NAMES.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|')})\\b`,
  'g',
);

const UNIT: Readonly<Record<string, string>> = {
  minute: 'm',
  minutes: 'm',
  min: 'm',
  hour: 'h',
  hours: 'h',
  day: 'd',
  days: 'd',
};

/** A transcript as command-bar words. */
export function normalizeSpoken(transcript: string): string {
  let text = transcript
    .toLowerCase()
    .trim()
    // Punctuation speech engines add: a final full stop, a "?" or "!", stray commas.
    .replace(/[.?!]+$/, '')
    // "65,000" → "65000"; "$1,800" → "1800".
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\$(\d)/g, '$1')
    .replace(/(\d)\s*(percent|per cent)\b/g, '$1%')
    .replace(/,/g, ' ');

  // "one hour", "an hour", "15 minutes", "fifteen minutes" → "1h", "15m".
  text = text.replace(
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty)[\s-]+(minutes?|min|hours?|days?)\b/g,
    (_, amount: string, unit: string) => `${NUMBER_WORDS[amount] ?? amount}${UNIT[unit] ?? unit}`,
  );
  text = text.replace(/\bhourly\b/g, '1h').replace(/\bdaily\b/g, '1d');
  // "two percent" → "2%".
  text = text.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*%/g,
    (_, word: string) => `${NUMBER_WORDS[word] ?? word}%`,
  );

  // Names to tickers, after the units, so "an hour" is not mistaken for anything else.
  const firstWord = /^\S+/.exec(
    text.replace(/^(please\s+)?(open( up)?|show( me)?|go to|switch to|bring up|give me)\s+/, ''),
  )?.[0];
  if (!SEARCH_WORDS.has(firstWord ?? '')) {
    text = text.replace(NAME_PATTERN, (name) => SPOKEN_NAMES.get(name) ?? name);
  }

  // Polite or filler openings, and words the bar has no use for.
  return (
    text
      .replace(/^(tell me|let me know|notify me|alert me)\s+(when|if)\s+/, 'alert ')
      .replace(/^(please\s+)?(open( up)?|show( me)?|go to|switch to|bring up|give me)\s+/, '')
      .replace(/\s+please$/, '')
      .replace(/\b(the|of|for)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // "crypto layout" → "layout crypto": the bar reads the layout word first.
      .replace(/^(.+?)\s+(layout|workspace)$/, 'layout $1')
  );
}
