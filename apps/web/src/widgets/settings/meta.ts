import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'settings',
  title: 'Settings',
  defaultSize: { width: 420, height: 520 },
  aliases: ['settings', 'keys', 'prefs', 'preferences'],
  dock: true,
  input: 'none',
  learn:
    'Your free keys and display choices. Keys stay in this browser and go only to their own provider.',
};

/** Providers whose free plans need the user's own key, in the order Settings lists them. */
export interface KeyProvider {
  /** Adapter id: the vault key and `getKey` name. */
  id: string;
  name: string;
  /** What a key switches on. */
  unlocks: string;
  /** Free-plan limits worth knowing before signing up. */
  limits: string;
  /** Input labels; multi-part keys are stored joined by ':' (see AdapterContext.getKey). */
  fields: readonly string[];
  signupUrl: string;
}

export const KEY_PROVIDERS: readonly KeyProvider[] = [
  {
    id: 'alpaca',
    name: 'Alpaca',
    unlocks: 'Live US stocks and ETFs from the IEX exchange, minute bars, history since 2016.',
    limits:
      'Free Basic plan: 30 symbols on the stream, one connection, 200 history calls a minute.',
    fields: ['API key ID', 'Secret key'],
    signupUrl: 'https://app.alpaca.markets/signup',
  },
  {
    id: 'finnhub',
    name: 'Finnhub',
    unlocks: 'Live US stock trades, company news, profiles and earnings dates.',
    limits:
      'Free plan: 60 calls a minute, 50 symbols on one stream connection; stock candles are a paid feature.',
    fields: ['API key'],
    signupUrl: 'https://finnhub.io/register',
  },
];
