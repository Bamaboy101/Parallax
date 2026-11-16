import { describe, expect, it } from 'vitest';
import { parseHistory, parseMidpoints } from './store';

describe('Polymarket CLOB answers', () => {
  it('reads batch midpoints, keeping only probabilities', () => {
    expect(parseMidpoints({ a: '0.085', b: '0.915', c: 'x', d: '1.5' })).toEqual({
      a: 0.085,
      b: 0.915,
    });
    expect(() => parseMidpoints([])).toThrow();
  });

  it('reads price history in epoch ms, oldest first', () => {
    expect(
      parseHistory({
        history: [
          { t: 1794864795, p: 0.0025 },
          { t: 1794261618, p: 0.0045 },
          { t: 'bad', p: 1 },
        ],
      }),
    ).toEqual([
      { t: 1794261618000, p: 0.0045 },
      { t: 1794864795000, p: 0.0025 },
    ]);
    expect(() => parseHistory({})).toThrow();
  });
});
