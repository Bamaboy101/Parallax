import { describe, expect, it } from 'vitest';
import { usePrefs } from '../store/prefs';
import { presetsFor, widgetsFor } from './modes';
import { panelTitle, widgetMeta, WIDGETS } from './widgets';

const metas = WIDGETS.map((widget) => widget.meta);

describe('Simple and Pro modes', () => {
  it('leaves the traders panels out of Simple and keeps everything in Pro', () => {
    const simple = widgetsFor('simple', metas).map((meta) => meta.id);
    for (const id of ['book', 'tape', 'derivs', 'options', 'rates', 'constellation', 'onchain']) {
      expect(simple).not.toContain(id);
    }
    expect(simple).toEqual(expect.arrayContaining(['watchlist', 'chart', 'news', 'predictions']));
    expect(widgetsFor('pro', metas)).toHaveLength(metas.length);
  });

  it('offers only presets made of Simple panels in Simple, starting with its own', () => {
    const simple = presetsFor('simple');
    expect(simple.map((workspace) => workspace.id)).toContain('simple');
    expect(simple.map((workspace) => workspace.id)).not.toContain('mission-control');
    for (const workspace of simple) {
      for (const panel of workspace.panels) expect(widgetMeta(panel.component)?.pro).not.toBe(true);
    }
  });

  it('titles panels with plain names in Simple and trading labels in Pro', () => {
    const chart = widgetMeta('chart');
    if (!chart) throw new Error('chart missing');
    usePrefs.setState({ mode: 'simple' });
    expect(panelTitle(chart, { symbol: 'ETH-USD' })).toBe('Chart · Ether');
    expect(panelTitle(chart, { symbol: 'EUR-USD' })).toBe('Chart · Euro, in dollars');
    usePrefs.setState({ mode: 'pro' });
    expect(panelTitle(chart, { symbol: 'ETH-USD' })).toBe('Chart · ETH/USD');
  });

  it('switches Learn hints on when Simple is chosen, and leaves them alone for Pro', () => {
    usePrefs.getState().setMode('simple');
    expect(usePrefs.getState().learn).toBe(true);
    usePrefs.getState().setLearn(false);
    usePrefs.getState().setMode('pro');
    expect(usePrefs.getState().learn).toBe(false);
  });
});
