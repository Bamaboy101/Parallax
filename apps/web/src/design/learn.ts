import { formatAge, type Freshness } from './format';
import { sourceName } from './sources';

/**
 * F5 learn mode: plain-language explanations for students and new traders. One glossary for every
 * column, label and number the panels show, looked up by the column's header text.
 */
export const GLOSSARY: Readonly<Record<string, string>> = {
  Symbol:
    'The short code for what is traded, such as BTC/USD (bitcoin priced in dollars) or AAPL (Apple).',
  Trend: 'A tiny line of the price over the last day (or the latest session for US stocks).',
  Last: 'The most recent price someone traded at.',
  Chg: 'How much the price has moved: over 24 hours for crypto and currencies, since the previous close for US stocks. Green is up, red is down.',
  Change: 'How much the value moved since the reading before.',
  Market: 'The market this row stands for.',
  Proxy:
    'A US-listed fund that tracks the market. It is not the market itself, and it only trades in New York hours.',
  Feed: 'Where this row’s price comes from right now: a live stream, or a poll every 15 seconds.',
  Pair: 'Two currencies quoted against each other: EUR/USD is how many dollars one euro buys.',
  Mid: 'Halfway between the best price buyers offer (bid) and sellers ask (ask).',
  Currency: 'A currency’s three-letter code, such as JPY for the Japanese yen.',
  '1 USD =':
    'How many units of that currency one US dollar buys at the European Central Bank’s daily fixing.',
  Perp: 'A perpetual future: a crypto contract that tracks the coin’s price and never expires.',
  Mark: 'The price the exchange uses to value positions, smoothed so one odd trade cannot move it.',
  Funding:
    'What one side pays the other every few hours to keep a perpetual near the coin’s price. Positive means buyers (longs) pay sellers (shorts).',
  Next: 'Time until the next funding payment.',
  OI: 'Open interest: the value of all perpetual contracts still open. Rising open interest means more money is betting on the coin.',
  Time: 'When it happened, on your clock.',
  Position: 'Long means a bet the price rises; short means a bet it falls.',
  Price: 'The price of this trade or order level.',
  USD: 'The value in US dollars.',
  Size: 'How much was traded or is waiting at this price.',
  Spread:
    'The gap between the best bid and the best ask. A narrow spread means it is cheap to trade.',
  Cumulative: 'Everything waiting at this price and every better one, added up.',
  'Cum. size': 'Everything waiting at this price and every better one, added up.',
  'Bid depth': 'Buy orders waiting below the price: how much someone is ready to buy.',
  'Ask depth': 'Sell orders waiting above the price: how much someone is ready to sell.',
  Index: 'A stock index: one number for a basket of a country’s biggest companies.',
  Source:
    'Where the number comes from: a live currency feed, a US-listed fund (proxy) or an official close.',
  Indicator: 'An economic statistic, such as inflation or unemployment.',
  Latest: 'The most recent published value.',
  'As of': 'The date the latest value refers to.',
  Qty: 'How many shares.',
  Avg: 'The average price you paid for this position.',
  Value: 'What the position is worth at the latest price.',
  'P&L':
    'Profit and loss: how much the position is up or down, in dollars and percent. Paper money only.',
  Equity: 'What the paper account is worth now: cash plus positions. Fake money.',
  Today: 'How much the paper account gained or lost since the last close.',
  'Buying power': 'How much the paper account can still spend, including margin (borrowing).',
  Cash: 'Paper cash not tied up in positions.',
  Side: 'Buy or sell: which way the paper order trades.',
  'Type / limit': 'Market fills at the next price; limit fills only at the price shown or better.',
  Status: 'Where the paper order stands: accepted and waiting, partly filled, filled or cancelled.',
  Odds: 'What traders pay for this outcome on a prediction market, as a percentage. Market odds, not a forecast.',
};

/** What a truth badge means, in plain words. */
export function badgeExplanation(freshness: Freshness, source: string): string {
  const name = sourceName(source);
  switch (freshness.kind) {
    case 'live':
      return freshness.stale
        ? `Live from ${name}, but nothing new has arrived for a while, so the price may be old.`
        : `Live from ${name}: prices stream in as they happen. ${formatAge(freshness.ageMs)} is how long the latest update took to reach you.`;
    case 'delayed':
      return `Delayed: ${name} sends this ${String(freshness.minutes)} minutes late.`;
    case 'polled':
      return `Polled: fetched from ${name} every ${formatAge(freshness.everyMs)}, not streamed, so it can be that old.`;
    case 'eod':
      return `End of day: ${name} publishes this once per trading day.`;
    case 'connecting':
      return `Connecting to ${name}: nothing has arrived yet.`;
    case 'rate-limited':
      return `${name} asked us to slow down (too many requests). The terminal waits, then tries again.`;
    case 'no-key':
      return `${name} needs a free key from you. Add one in Settings; it stays in your browser.`;
    case 'key-rejected':
      return `${name} refused the saved key. Check it in Settings.`;
    case 'offline':
      return `${name} is not answering right now; the terminal keeps trying.`;
  }
}

export interface Explanation {
  term: string;
  text: string;
}

const lookup = (term: string): Explanation | null => {
  const key = term.replace(/\s+/g, ' ').trim();
  const text = GLOSSARY[key];
  return text ? { term: key, text } : null;
};

/** The header that labels a row's columns: the `-columns` grid it shares, in the same panel. */
function headerFor(row: Element): Element | null {
  const grid = [...row.classList].find(
    (name) => name.endsWith('-columns') && name !== 'market-columns',
  );
  const panel = row.closest('.market-panel, .dv-content-container') ?? row.ownerDocument.body;
  if (!grid) return null;
  return (
    [...panel.querySelectorAll(`.market-columns.${CSS.escape(grid)}`)].find(
      (header) => header !== row,
    ) ?? null
  );
}

/**
 * What the element under the pointer means: an explicit `data-term` glossary term, a column
 * header, a number in a row (by its column's header) or a labelled account figure. Truth badges
 * are explained by the caller, which reads their state. (`data-learn` is taken: it marks <html>
 * while learn mode is on.)
 */
export function explainElement(target: Element): Explanation | null {
  const tagged = target.closest('[data-term]');
  const key = tagged?.getAttribute('data-term');
  if (key) return lookup(key);

  const headerCell = target.closest('.market-columns > *');
  if (headerCell) return lookup(headerCell.textContent);

  const cell = target.closest('.market-row > *');
  const row = cell?.parentElement;
  if (cell && row) {
    const index = [...row.children].indexOf(cell);
    const header = headerFor(row)?.children[index];
    if (header) return lookup(header.textContent);
  }

  const figure = target.closest('dt, dd')?.closest('div');
  const label = figure?.querySelector('dt')?.textContent;
  if (label) return lookup(label);
  return null;
}
