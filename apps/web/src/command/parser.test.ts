import { describe, expect, it } from 'vitest';
import type { WidgetMeta } from '../widgets/types';
import { suggest } from './parser';
import { searchInstruments } from './search';

const widget = (id: string, aliases: string[], input: WidgetMeta['input']): WidgetMeta => ({
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1),
  defaultSize: { width: 1, height: 1 },
  aliases,
  dock: true,
  input,
  learn: `${id} panel`,
});
const WIDGETS = [
  widget('chart', ['chart', 'candles'], 'symbol'),
  widget('book', ['book', 'depth'], 'symbol'),
  widget('watchlist', ['watch', 'watchlist'], 'symbols'),
  widget('news', ['news'], 'query'),
  widget('settings', ['settings', 'keys'], 'none'),
  { ...widget('ticker-rail', ['rail'], 'none'), dock: false },
];
const LAYOUTS = ['default', 'crypto', 'macro'];

describe('searchInstruments', () => {
  it('ranks the USD pair first for a bare base', () => {
    expect(
      searchInstruments('btc')
        .map((i) => i.id)
        .slice(0, 2),
    ).toEqual(['BTC-USD', 'BTC-USDT']);
  });

  it('matches pairs however they are typed', () => {
    for (const query of ['eth usdt', 'ETH/USDT', 'ethusdt']) {
      expect(searchInstruments(query)[0]?.id).toBe('ETH-USDT');
    }
    expect(searchInstruments('eur/usd')[0]?.id).toBe('EUR-USD');
  });

  it('finds instruments by name and by fuzzy letters', () => {
    expect(searchInstruments('gold')[0]?.id).toBe('PAXG-USD');
    expect(searchInstruments('dge')[0]?.id).toBe('DOGE-USD');
    expect(searchInstruments('zzzz')).toEqual([]);
  });
});

describe('suggest', () => {
  it('loads a bare symbol into the active panel', () => {
    expect(suggest('BTC', WIDGETS, LAYOUTS)[0]?.command).toMatchObject({
      kind: 'load',
      symbol: { id: 'BTC-USD' },
    });
  });

  it('opens a widget with symbol and interval in any word order', () => {
    for (const text of ['btc chart 1h', 'chart 1h btc', '1h BTC chart']) {
      expect(suggest(text, WIDGETS, LAYOUTS)[0]).toMatchObject({
        title: 'Chart BTC/USD 1h',
        command: {
          kind: 'open',
          widget: { id: 'chart' },
          symbol: { id: 'BTC-USD' },
          interval: '1h',
        },
      });
    }
  });

  it('adds to a list widget', () => {
    expect(suggest('watch sol', WIDGETS, LAYOUTS)[0]).toMatchObject({
      title: 'Add SOL/USD to Watchlist',
      command: { kind: 'open', widget: { id: 'watchlist' }, symbol: { id: 'SOL-USD' } },
    });
  });

  it('passes free text to a query widget', () => {
    expect(suggest('news tesla earnings', WIDGETS, LAYOUTS)[0]?.command).toMatchObject({
      kind: 'open',
      widget: { id: 'news' },
      query: 'tesla earnings',
    });
  });

  it('offers no news command while no widget registers the alias', () => {
    expect(suggest('news tesla', WIDGETS.slice(0, 3), LAYOUTS)).toEqual([]);
  });

  it('opens a widget that takes no input by its alias, but not one the shell places', () => {
    const [open] = suggest('keys', WIDGETS, LAYOUTS);
    expect(open?.command).toMatchObject({ kind: 'open', widget: { id: 'settings' } });
    expect(suggest('rail', WIDGETS, LAYOUTS).every((s) => s.command.kind !== 'open')).toBe(true);
  });

  it('switches layouts by prefix', () => {
    expect(suggest('layout cr', WIDGETS, LAYOUTS).map((s) => s.command)).toEqual([
      { kind: 'layout', name: 'crypto' },
    ]);
    expect(suggest('layout', WIDGETS, LAYOUTS)).toHaveLength(3);
  });

  it('suggests nothing for empty input', () => {
    expect(suggest('   ', WIDGETS, LAYOUTS)).toEqual([]);
  });
});
