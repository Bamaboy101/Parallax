import { usePrefs } from '../store/prefs';
import type { Instrument } from '../store/symbols';
import { plainName } from './plain';

/** E2: a symbol's name as the mode shows it: "Bitcoin" in Simple, "BTC/USD" in Pro. */
export function SymbolLabel({ item }: { item: Instrument }) {
  const simple = usePrefs((state) => state.mode === 'simple');
  return <>{simple ? plainName(item) : item.label}</>;
}
