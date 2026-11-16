import { formatDuration, market, sessionState } from '../store/sessions';

/** One index row: its US-listed ETF proxy, or an official level where a licence allows one. */
export interface IndexRow {
  /** Unique within the board (two indices can share one proxy). */
  key: string;
  index: string;
  /** Catalogue id of the US-listed ETF proxy. */
  proxy?: string;
  /** An official level the project may display. */
  official?: 'taiex';
}

export interface RegionBoard {
  id: 'europe' | 'asia-pacific';
  title: string;
  /** Kraken pairs that move live during the region's own hours, shown first. */
  fx: readonly string[];
  /** Session ids (store/sessions.ts) of the region's exchanges. */
  sessions: readonly string[];
  groups: readonly { title: string; rows: readonly IndexRow[] }[];
}

/** Shown on every proxy row: no free source allows displaying the official level. */
export const LICENCE_NOTE = 'official index level needs a licence';
export const PROXY_LABEL = 'proxy, US hours only';

const proxy = (index: string, id: string): IndexRow => ({
  key: `${index}:${id}`,
  index,
  proxy: id,
});

export const EUROPE: RegionBoard = {
  id: 'europe',
  title: 'Europe',
  fx: ['EUR-USD', 'GBP-USD', 'USD-CHF'],
  sessions: ['frankfurt', 'london'],
  groups: [
    {
      title: 'Indices',
      rows: [
        proxy('DAX', 'EWG'),
        proxy('FTSE 100', 'EWU'),
        proxy('CAC 40', 'EWQ'),
        proxy('Euro Stoxx 50', 'FEZ'),
        proxy('IBEX 35', 'EWP'),
        proxy('FTSE MIB', 'EWI'),
        proxy('SMI', 'EWL'),
        proxy('AEX', 'EWN'),
        proxy('Developed Europe', 'VGK'),
      ],
    },
  ],
};

export const ASIA_PACIFIC: RegionBoard = {
  id: 'asia-pacific',
  title: 'Asia-Pacific',
  fx: ['USD-JPY', 'AUD-USD'],
  sessions: ['sydney', 'tokyo', 'hong-kong', 'mumbai'],
  groups: [
    { title: 'Japan', rows: [proxy('Nikkei 225', 'EWJ'), proxy('TOPIX', 'EWJ')] },
    {
      title: 'Greater China',
      rows: [
        proxy('Hang Seng', 'EWH'),
        proxy('Shanghai Composite', 'FXI'),
        proxy('CSI 300', 'MCHI'),
        { key: 'TAIEX:official', index: 'TAIEX', official: 'taiex' },
        proxy('Taiwan', 'EWT'),
      ],
    },
    { title: 'Korea', rows: [proxy('KOSPI', 'EWY')] },
    { title: 'India', rows: [proxy('Sensex', 'INDA'), proxy('Nifty 50', 'INDA')] },
    { title: 'Singapore', rows: [proxy('STI', 'EWS')] },
    {
      title: 'Australia and New Zealand',
      rows: [proxy('ASX 200', 'EWA'), proxy('NZX 50', 'ENZL')],
    },
  ],
};

/**
 * While the region's exchanges trade and New York does not, the ETF proxies are frozen at the
 * last US close: say which exchanges are open and point to the live currency rows. Null otherwise.
 */
export function regionOpenNotice(board: RegionBoard, now: number): string | null {
  const newYork = market('new-york');
  if (!newYork) return null;
  const us = sessionState(newYork, now);
  if (us.open) return null;
  const open = board.sessions.flatMap((id) => {
    const found = market(id);
    return found && sessionState(found, now).open ? [found.name] : [];
  });
  if (open.length === 0) return null;
  const names =
    open.length === 1 ? open[0] : `${open.slice(0, -1).join(', ')} and ${String(open.at(-1))}`;
  const reopens =
    us.minutesToChange === undefined
      ? ''
      : ` (New York opens in ${formatDuration(us.minutesToChange)})`;
  return (
    `${String(names)} ${open.length === 1 ? 'is' : 'are'} open and the US is closed, so the ` +
    `proxies below hold their last US close${reopens}. The currency rows above move live now.`
  );
}
