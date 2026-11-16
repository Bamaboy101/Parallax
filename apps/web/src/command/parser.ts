import type { BarInterval } from '../feeds/types';
import type { Instrument } from '../store/symbols';
import type { WidgetMeta } from '../widgets/types';
import { searchInstruments } from './search';

/** What a chosen suggestion does. Carried out by app/commands.ts. */
export type Command =
  /** Open a widget, or for list widgets add to the open one. */
  | {
      kind: 'open';
      widget: WidgetMeta;
      symbol?: Instrument;
      interval?: BarInterval;
      query?: string;
    }
  /** Show an instrument in the active panel. */
  | { kind: 'load'; symbol: Instrument }
  /** Replace the dock with a preset layout. */
  | { kind: 'layout'; name: string };

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  command: Command;
}

const INTERVALS = new Set<string>(['1m', '5m', '15m', '1h', '4h', '1d']);
const LAYOUT_WORDS = new Set(['layout', 'workspace', 'ws']);

const isInterval = (token: string): token is BarInterval => INTERVALS.has(token);

function openTitle(widget: WidgetMeta, symbol: Instrument | undefined, interval?: BarInterval) {
  if (!symbol) return `Open ${widget.title}`;
  if (widget.input === 'symbols') return `Add ${symbol.label} to ${widget.title}`;
  return `${widget.title} ${symbol.label}${interval ? ` ${interval}` : ''}`;
}

/**
 * Turn command-bar text into ranked suggestions.
 *
 * - `btc` → show BTC/USD in the active panel
 * - `btc chart 1h` → open a 1-hour BTC/USD chart (word order is free)
 * - `watch sol` → add SOL/USD to the watchlist
 * - `news tesla` → news filtered to "tesla", once a widget registers the `news` alias
 * - `layout crypto` → switch to a preset layout
 */
export function suggest(
  input: string,
  widgets: readonly WidgetMeta[],
  layouts: readonly string[],
): Suggestion[] {
  const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [first, ...rest] = tokens;
  if (first === undefined) return [];

  if (LAYOUT_WORDS.has(first)) {
    const wanted = rest.join(' ');
    return layouts
      .filter((name) => name.toLowerCase().startsWith(wanted))
      .map((name) => ({
        id: `layout:${name}`,
        title: `Layout: ${name}`,
        detail: 'Replace the current panels',
        command: { kind: 'layout', name },
      }));
  }

  const commandable = widgets.filter((widget) => widget.dock);
  let widget: WidgetMeta | undefined;
  let interval: BarInterval | undefined;
  const words: string[] = [];
  for (const token of tokens) {
    const named = widget ? undefined : commandable.find((w) => w.aliases.includes(token));
    if (named) widget = named;
    else if (!interval && isInterval(token)) interval = token;
    else words.push(token);
  }
  const text = words.join(' ');

  if (widget?.input === 'none') {
    return [
      {
        id: `open:${widget.id}`,
        title: `Open ${widget.title}`,
        detail: '',
        command: { kind: 'open', widget },
      },
    ];
  }

  if (widget?.input === 'query') {
    const query = text === '' ? undefined : text;
    return [
      {
        id: `open:${widget.id}:${text}`,
        title: query ? `${widget.title}: ${query}` : `Open ${widget.title}`,
        detail: query ? `Search ${widget.title.toLowerCase()} for "${query}"` : '',
        command: { kind: 'open', widget, ...(query ? { query } : {}) },
      },
    ];
  }

  if (widget) {
    const target = widget;
    if (text === '') {
      return [
        {
          id: `open:${target.id}`,
          title: openTitle(target, undefined),
          detail: 'With its default symbol',
          command: { kind: 'open', widget: target, ...(interval ? { interval } : {}) },
        },
      ];
    }
    return searchInstruments(text).map((symbol) => ({
      id: `open:${target.id}:${symbol.id}`,
      title: openTitle(target, symbol, interval),
      detail: symbol.name,
      command: { kind: 'open', widget: target, symbol, ...(interval ? { interval } : {}) },
    }));
  }

  return searchInstruments(text).map((symbol) => ({
    id: `load:${symbol.id}`,
    title: symbol.label,
    detail: `${symbol.name}${symbol.note ? ` · ${symbol.note}` : ''} · show in the active panel`,
    command: { kind: 'load', symbol },
  }));
}
