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
  Bid: 'The highest price someone is offering to pay right now.',
  Ask: 'The lowest price someone is offering to sell at right now.',
  IV: 'Implied volatility: how much movement the option price assumes, as a yearly percentage. Higher means traders expect bigger swings.',
  Delta:
    'Roughly how much the option price moves when the stock moves one dollar; also a rough chance it ends in the money.',
  Vol: 'Contracts traded in the latest session.',
  Strike: 'The price the option lets you buy (call) or sell (put) the stock at.',
  Spot: 'The stock’s latest trade price.',
  'ATM IV': 'Implied volatility of the option nearest the current price (at the money).',
  'Put/call':
    'Puts traded for every call. Above 1 means more puts (bets or hedges on a fall) than calls changed hands.',
  Volume: 'Contracts traded in the latest session, calls and puts.',
  Tenor: 'How long the government borrows for: one month (1M) up to 30 years (30Y).',
  Yield:
    'The yearly return a Treasury pays if held to maturity: what the US government pays to borrow.',
  '1d': 'Change since the previous business day, in basis points (1 bp is 0.01 percentage point).',
  '1m': 'Change over the last month, in basis points.',
  '1y': 'Change over the last year, in basis points.',
  '2s10s':
    'The 10-year yield minus the 2-year. Below zero (an inverted curve) has often come before recessions.',
  '3m10y':
    'The 10-year yield minus the 3-month bill: another common recession signal when negative.',
  SOFR: 'The Secured Overnight Financing Rate: what it costs to borrow cash overnight against Treasuries.',
  EFFR: 'The effective federal funds rate: what banks charge each other overnight, kept inside the Fed’s target range.',
  Liquidity:
    'The order book over time, drawn behind price: each band is where buy and sell orders were waiting, shaded more strongly where more size sat. Only since this page started recording the book.',
  'Open now':
    'Stock exchanges in their regular trading hours right now, lit mint on the globe. Holidays are not taken into account.',
  'Biggest moves':
    'The three markets whose US-listed fund (an ETF that tracks the country) moved most since its previous close, drawn as arcs from New York, where those funds trade.',
  Whale:
    'An unusually large trade: worth at least $100,000 and among the biggest 0.5% of this market’s trades in the last hour. Large forced closes (liquidations) on the matching futures count too. A whale shows size, not which way the price will go.',
  'Next block':
    'The Bitcoin fee, in satoshis per virtual byte, likely to get a transaction into the very next block. Higher fees go first.',
  '30 min':
    'The Bitcoin fee likely to confirm a transaction within about 30 minutes (three blocks).',
  '1 hour': 'The Bitcoin fee likely to confirm a transaction within about an hour (six blocks).',
  Economy:
    'The lowest Bitcoin fee that should still confirm, eventually, when the network is quiet.',
  Mempool:
    'Bitcoin transactions waiting to be put in a block. A block holds about 1 vMB, so the size says roughly how many blocks it would take to clear.',
  'Base fee':
    'The fee every Ethereum transaction in the next block must pay, in gwei (a billionth of an ether). The network sets it from how full recent blocks were.',
  Slow: 'Base fee plus a small tip: what the cheapest quarter of recent transactions paid.',
  Standard: 'Base fee plus a typical tip: what the middle of recent transactions paid.',
  Fast: 'Base fee plus a generous tip: what the top quarter of recent transactions paid.',
  'Stablecoin supply':
    'How many of each dollar-pegged token exist on Ethereum, read from the token’s own contract. The same tokens also exist on other blockchains, not counted here.',
  'Fear & Greed':
    'A daily mood index for crypto from alternative.me, 0 (extreme fear) to 100 (extreme greed), built from price swings, momentum, social media and search interest. A mood, not a forecast.',
  // Energy (M4)
  Measure: 'What is being counted, and the unit it is counted in.',
  Week: 'Change since the week before (for the spot prices, since the day before).',
  'vs 5-yr':
    'This week’s change minus the average change in the same week of the previous five years. Storage always rises and falls with the seasons; this shows whether this week was unusual for the time of year. A seasonal norm, not what analysts expected.',
  Stocks:
    'How much oil, fuel and gas is held in storage across the US, counted each week by the government’s Energy Information Administration (EIA).',
  Supply:
    'How much crude oil the US pumps each day, and how much of its refining capacity is running.',
  'Spot prices':
    'What oil and natural gas cost for delivery now at the main US trading hubs, daily.',
  'Crude stocks (ex-SPR)':
    'Crude oil held by companies in tanks and pipelines, in millions of barrels, leaving out the government’s emergency reserve.',
  'Gasoline stocks': 'Gasoline held in storage across the US, in millions of barrels.',
  'Distillate stocks':
    'Diesel and heating oil (distillates) held in storage across the US, in millions of barrels.',
  SPR: 'The Strategic Petroleum Reserve: crude oil the US government keeps for emergencies, in millions of barrels.',
  'Gas storage (Lower 48)':
    'Natural gas held underground in the 48 connected states, in billions of cubic feet (Bcf). It builds through summer and is drawn down for winter heating.',
  'Crude production': 'Crude oil pumped from US fields each day, in millions of barrels per day.',
  'Refinery utilisation':
    'How much of the country’s refining capacity is running, in percent. High in summer driving season, lower during autumn maintenance.',
  'WTI spot (Cushing)':
    'The price of a barrel of West Texas Intermediate, the US benchmark crude, delivered at the Cushing, Oklahoma hub.',
  'Henry Hub spot':
    'The price of natural gas at Henry Hub in Louisiana, the US benchmark, in dollars per million British thermal units (MMBtu).',
  // Corporate events (M7)
  Earnings:
    'When a company publishes its quarterly results: how much it sold and earned. Share prices often jump or drop on the day.',
  Date: 'The day it happens (earnings) or the day the trade was made (insiders).',
  Company: 'The company reporting, by its ticker.',
  When: 'Before the market opens, after it closes, or during trading hours, as the company has said.',
  'EPS est.':
    'Earnings per share that analysts expect, on average: the company’s profit divided by its shares. Results are often judged against this number.',
  'Revenue est.': 'Sales that analysts expect for the quarter, on average.',
  'Insider trades':
    'Shares bought, sold, granted or given away by the company’s directors, senior officers and owners of more than 10%. They must report each one to the SEC on Form 4 within two business days.',
  Who: 'The insider who reported the trade, and their role at the company.',
  Trade:
    'What happened: a buy or sell on the market, shares granted as pay, options turned into shares, shares kept back for tax, or a gift.',
  Shares: 'How many shares changed hands: plus for shares received, minus for shares given up.',
  '10b5-1':
    'Made under a trading plan the insider set up in advance (SEC Rule 10b5-1), so the timing was fixed months earlier, not chosen on the day.',
  'Large holders':
    'Investors who own more than 5% of the company. They must file Schedule 13D (if they may seek to influence it) or the shorter 13G (if they are passive) with the SEC.',
  Holder: 'The investor who filed, as named in the filing.',
  Stake: 'The share of the company’s stock the holder reported owning, in percent.',
  Form: 'The SEC form: 13D or 13G, with /A for an update to an earlier filing.',
  Filed: 'The day the filing reached the SEC.',
  // Global macro (M8)
  Country: 'The economy, as the IMF names it. The table lists the 50 largest by GDP.',
  GDP: 'Gross domestic product: the value of everything the economy produces in a year, in US dollars, from the World Bank’s latest full year.',
  Growth:
    'How much the economy is expected to grow this year after removing inflation (real GDP growth), the IMF’s estimate.',
  Inflation:
    'How much prices are expected to rise on average this year (consumer prices), the IMF’s estimate.',
  Debt: 'What the government owes, as a share of the economy’s yearly output (gross general government debt, % of GDP), the IMF’s estimate.',
  'Map shading':
    'Darker means a higher value. Each of the five shades holds about a fifth of the countries with data; grey means no figure.',
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
      if (freshness.cadence === 'weekly')
        return `Weekly: ${name} publishes this once a week, so it can be up to a week old.`;
      if (freshness.cadence === 'annual')
        return `Annual: ${name} publishes these figures once a year; the latest year shown is the newest on record.`;
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
