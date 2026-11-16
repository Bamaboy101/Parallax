import { useEffect } from 'react';
import { instruments } from '../store/symbols';
import { useTickStore } from '../store/ticks';
import { marketWeather } from '../store/weather';
import { DEFAULT_SYMBOLS } from '../widgets/watchlist/meta';
import { dockApi } from './dockApi';

const REFRESH_MS = 10_000;

/** Symbols on the desk's watchlists, or the default list when none is open. */
function watchlistSymbols(): string[] {
  const lists = (dockApi()?.panels ?? [])
    .filter((panel) => panel.api.component === 'watchlist')
    .map((panel) => {
      const symbols: unknown = panel.params?.symbols;
      return Array.isArray(symbols)
        ? symbols.filter((id) => typeof id === 'string')
        : DEFAULT_SYMBOLS;
    });
  return [...new Set(lists.length > 0 ? lists.flat() : DEFAULT_SYMBOLS)];
}

/**
 * Market weather: every 10 s, compare the watchlist's last 5 minutes of volatility with its hour
 * and publish it on <html> (`data-weather`, `--weather` 0..1) for the glow behind the panels.
 * Follows the Rewind cursor. Nothing is published until there is an hour-scale baseline.
 */
export function useMarketWeather(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const at = useTickStore.getState().cursor ?? Date.now();
      const weather = marketWeather(instruments(watchlistSymbols()), at);
      if (!weather) {
        delete root.dataset.weather;
        root.style.removeProperty('--weather');
        return;
      }
      root.dataset.weather = weather.label;
      root.style.setProperty('--weather', weather.score.toFixed(2));
    };
    update();
    const timer = window.setInterval(update, REFRESH_MS);
    const unsubscribe = useTickStore.subscribe((state, previous) => {
      if (state.cursor !== previous.cursor) update();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);
}
