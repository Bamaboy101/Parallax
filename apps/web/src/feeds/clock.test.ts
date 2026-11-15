import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureClockOffset } from './clock';

afterEach(() => {
  vi.useRealTimers();
});

describe('measureClockOffset', () => {
  it('uses the midpoint of the fastest round trip', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    // Local clock is 800 ms behind; round trips of 300, 40 and 200 ms.
    const trips = [300, 40, 200];
    let call = 0;
    const serverTime = async () => {
      const trip = trips[call] ?? 0;
      call += 1;
      const midpoint = Date.now() + trip / 2;
      await vi.advanceTimersByTimeAsync(trip);
      return midpoint + 800;
    };
    await expect(measureClockOffset(serverTime)).resolves.toBe(800);
  });
});
