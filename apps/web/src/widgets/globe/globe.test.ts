import { describe, expect, it } from 'vitest';
import { placeLabel } from './draw';
import { biggestMoves, dragged, inDaylight, openingView, subsolarPoint, VIEWS } from './model';

describe('subsolarPoint', () => {
  it('puts the sun over the equator at the March equinox and over the Tropic of Cancer in June', () => {
    // 2026-03-20 14:46 UTC equinox: latitude ~0.
    const [, march] = subsolarPoint(Date.UTC(2026, 2, 20, 14, 46));
    expect(Math.abs(march)).toBeLessThan(0.1);
    // 2026-06-21 08:24 UTC solstice: latitude ~23.44.
    const [, june] = subsolarPoint(Date.UTC(2026, 5, 21, 8, 24));
    expect(june).toBeCloseTo(23.44, 1);
  });

  it('puts the sun near the Greenwich meridian at noon UTC, give or take the equation of time', () => {
    // 3 Nov: the sun runs about 16.4 minutes fast, so it crosses Greenwich ~11:44 UTC (~4.1° east).
    const [lon] = subsolarPoint(Date.UTC(2026, 10, 3, 12));
    expect(lon).toBeLessThan(-3.6);
    expect(lon).toBeGreaterThan(-4.6);
  });

  it('knows Tokyo is in daylight at 03:00 UTC and in the dark at 15:00 UTC', () => {
    const tokyo = [139.69, 35.69] as const;
    expect(inDaylight(tokyo, Date.UTC(2026, 10, 17, 3))).toBe(true);
    expect(inDaylight(tokyo, Date.UTC(2026, 10, 17, 15))).toBe(false);
  });
});

describe('biggestMoves', () => {
  it('ranks by size either way and skips markets without a change', () => {
    const moves = biggestMoves({ EWJ: 0.4, EWY: -2.1, EWG: 1.3, EWU: undefined, EWA: Number.NaN });
    expect(moves.map((move) => [move.country, move.changePct])).toEqual([
      ['Korea', -2.1],
      ['Germany', 1.3],
      ['Japan', 0.4],
    ]);
  });

  it('draws nothing before any change arrives', () => {
    expect(biggestMoves({})).toEqual([]);
  });
});

describe('the view', () => {
  it('opens where exchanges are open, else on the viewer’s side of the world', () => {
    expect(openingView(new Set(['london', 'new-york']), 0)).toEqual(VIEWS[0]?.centre);
    expect(openingView(new Set(['frankfurt']), 0)).toEqual(VIEWS[1]?.centre);
    expect(openingView(new Set(['tokyo']), 0)).toEqual(VIEWS[2]?.centre);
    // Nothing open, viewer at UTC+9: 135° east.
    expect(openingView(new Set(), 9 * 60)[0]).toBe(135);
  });

  it('turns with a drag and never tips over a pole', () => {
    const [lon, lat] = dragged([0, 0], 100, 0, 100);
    expect(lon).toBe(-90);
    expect(lat).toBe(0);
    expect(dragged([0, 70], 0, 400, 100)[1]).toBe(80);
    expect(dragged([170, 0], -40, 0, 100)[0]).toBe(-154);
  });
});

describe('placeLabel', () => {
  it('moves a city name to the other side when its neighbour took the first spot, and gives up when boxed in', () => {
    // London at (100, 100) took the spot right of it; Frankfurt sits 4 px away.
    const london = placeLabel({ at: [100, 100], side: 'beside' }, 40, [], 400, 400);
    expect(london).toEqual({ x: 107, y: 94, width: 40, height: 12 });
    const frankfurt = placeLabel(
      { at: [104, 102], side: 'beside' },
      56,
      london ? [london] : [],
      400,
      400,
    );
    expect(frankfurt?.x).toBe(104 - 7 - 56);
    // Boxed in on every side: left out rather than drawn over another label.
    const everywhere = [{ x: 0, y: 0, width: 400, height: 400 }];
    expect(placeLabel({ at: [200, 200], side: 'under' }, 30, everywhere, 400, 400)).toBeNull();
  });

  it('keeps labels on the canvas', () => {
    // A dot at the right edge: the name goes on its left.
    const box = placeLabel({ at: [395, 200], side: 'beside' }, 50, [], 400, 400);
    expect(box?.x).toBe(395 - 7 - 50);
  });
});
