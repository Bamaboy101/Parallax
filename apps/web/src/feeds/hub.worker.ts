/// <reference lib="webworker" />
import { registrations } from './adapters';
import { measureClockOffset } from './clock';
import { FeedHub } from './hub';
import type { HubRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/** Longest a batch may wait when the page is hidden and frames stop. */
const FRAME_FALLBACK_MS = 50;
const CLOCK_SYNC_MS = 10 * 60_000;

let clockOffset = 0;
function syncClock(): void {
  measureClockOffset().then(
    (offset) => {
      clockOffset = offset;
    },
    (error: unknown) => {
      console.warn(`[feed] clock sync failed: ${error instanceof Error ? error.message : ''}`);
    },
  );
}
syncClock();
self.setInterval(syncClock, CLOCK_SYNC_MS);

const hub = new FeedHub(registrations, {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout: (callback, ms) => self.setTimeout(callback, ms),
  clearTimeout: (id) => {
    self.clearTimeout(id);
  },
  setInterval: (callback, ms) => self.setInterval(callback, ms),
  clearInterval: (id) => {
    self.clearInterval(id);
  },
  nextFrame: (callback) => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      callback();
    };
    // Frames align batches with paint; the timeout keeps batches flowing while the tab is hidden.
    if ('requestAnimationFrame' in self) self.requestAnimationFrame(run);
    self.setTimeout(run, FRAME_FALLBACK_MS);
  },
  post: (message) => {
    self.postMessage(message);
  },
  log: (level, message) => {
    console[level](`[feed] ${message}`);
  },
  clockOffset: () => clockOffset,
});

self.addEventListener('message', (event: MessageEvent<HubRequest>) => {
  hub.handle(event.data);
});
