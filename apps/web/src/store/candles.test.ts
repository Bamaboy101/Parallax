import { describe, expect, it } from 'vitest';
import type { Bar, BarEvent } from '../feeds/types';
import { foldLive } from './candles';

const MIN = 60_000;
const T = 1_800_000_000_000 - (1_800_000_000_000 % (15 * MIN)); // aligned to 15 minutes

const minute = (
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): BarEvent => ({
  channel: 'bar',
  interval: '1m',
  symbol: 'BTC-USD',
  source: 'coinbase',
  receivedAt: ts + 30_000,
  ts,
  open,
  high,
  low,
  close,
  volume,
});

describe('foldLive', () => {
  const history: Bar[] = [
    { ts: T - 15 * MIN, open: 90, high: 95, low: 89, close: 94, volume: 10 },
    // The forming 15-minute bar, as fetched 2.5 minutes in: 3 minutes of volume.
    { ts: T, open: 94, high: 96, low: 93, close: 95, volume: 3 },
  ];
  const loadedAt = T + 2 * MIN + 30_000;

  it('continues the forming bar without counting the fetch minute twice', () => {
    const tail = foldLive(
      history,
      [
        minute(T + MIN, 94, 96, 94, 95, 1), // before the fetch minute: already in history
        minute(T + 2 * MIN, 95, 97, 95, 96, 1), // the fetch minute: prices fold in, volume does not
        minute(T + 3 * MIN, 96, 98, 92, 97, 2), // after: everything folds in
      ],
      '15m',
      loadedAt,
    );
    expect(tail).toEqual([{ ts: T, open: 94, high: 98, low: 92, close: 97, volume: 5 }]);
  });

  it('opens new bars after the history ends with every minute counted', () => {
    const tail = foldLive(
      history,
      [minute(T + 15 * MIN, 97, 99, 96, 98, 4), minute(T + 16 * MIN, 98, 100, 97, 99, 1)],
      '15m',
      loadedAt,
    );
    expect(tail).toEqual([
      { ts: T + 15 * MIN, open: 97, high: 100, low: 96, close: 99, volume: 5 },
    ]);
  });

  it('builds bars from live minutes when there is no history', () => {
    const tail = foldLive([], [minute(T, 1, 2, 0.5, 1.5, 3)], '1h', T);
    expect(tail).toEqual([
      { ts: T - (T % (60 * MIN)), open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
    ]);
  });
});
