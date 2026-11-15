import { getJson } from './adapters/rest';
import { num } from './adapters/parse';

/** Coinbase's public time endpoint: epoch seconds with millisecond precision, open CORS. */
const TIME_URL = 'https://api.exchange.coinbase.com/time';

async function coinbaseTime(): Promise<number> {
  const body = await getJson(TIME_URL);
  if (typeof body !== 'object' || body === null || !('epoch' in body)) {
    throw new Error('time response has no epoch');
  }
  return num(body.epoch, 'epoch') * 1000;
}

/**
 * Exchange clock minus local clock, in ms, from the lowest-round-trip of a few samples (the
 * classic NTP midpoint estimate). Truth badges add it to local receive times, so a local clock
 * that runs behind the exchange no longer reads as 0 ms delay.
 */
export async function measureClockOffset(
  serverTime: () => Promise<number> = coinbaseTime,
  samples = 3,
): Promise<number> {
  let best: { roundTrip: number; offset: number } | null = null;
  for (let sample = 0; sample < samples; sample += 1) {
    const sent = Date.now();
    const server = await serverTime();
    const received = Date.now();
    const roundTrip = received - sent;
    if (!best || roundTrip < best.roundTrip) {
      best = { roundTrip, offset: server - (sent + received) / 2 };
    }
  }
  if (!best) throw new Error('no clock samples');
  return Math.round(best.offset);
}
