import { describe, expect, it } from 'vitest';
import { placeBodies, stepBodies, type Body } from './layout';

const distance = (a: Body | undefined, b: Body | undefined) =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.NaN;

describe('stepBodies', () => {
  it('draws correlated bodies together and pushes opposites apart, then settles', () => {
    const bodies = placeBodies(['BTC', 'ETH', 'USD-JPY'], [12, 12, 12], 400, 300);
    // BTC and ETH move together; the yen pair moves against both.
    const matrix = [
      [1, 0.95, -0.8],
      [0.95, 1, -0.8],
      [-0.8, -0.8, 1],
    ];
    let energy = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 600; step += 1) {
      energy = stepBodies(bodies, (i, j) => matrix[i]?.[j], 400, 300);
    }
    const [btc, eth, yen] = bodies;
    expect(distance(btc, eth)).toBeLessThan(distance(btc, yen) / 3);
    expect(distance(btc, eth)).toBeGreaterThanOrEqual(24); // never overlapping
    expect(energy).toBeLessThan(0.01);
    for (const body of bodies) {
      expect(body.x).toBeGreaterThanOrEqual(body.r);
      expect(body.x).toBeLessThanOrEqual(400 - body.r);
    }
  });

  it('keeps bodies with no correlation yet apart, without collapsing or drifting off', () => {
    const bodies = placeBodies(['A', 'B'], [10, 10], 300, 300);
    for (let step = 0; step < 600; step += 1) stepBodies(bodies, () => undefined, 300, 300);
    const gap = distance(bodies[0], bodies[1]);
    expect(gap).toBeGreaterThan(2 * 10 + 6 + 20);
    expect(gap).toBeLessThan(300 * 0.3);
  });
});
