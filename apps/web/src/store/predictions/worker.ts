/// <reference lib="webworker" />
import { retryAtFrom } from '../failure';
import { loadEvents } from './load';
import type { PredictionsReply } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/**
 * Fetches and curates Polymarket's event lists off the main thread: a refresh parses about
 * 9 MB of JSON, which would cost frames on the page. Only the curated events come back.
 */

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly retryAt: number | null,
  ) {
    super(`Polymarket answered HTTP ${String(status)}`);
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpFailure(response.status, retryAtFrom(response.headers.get('Retry-After')));
  }
  return response.json() as Promise<unknown>;
}

function reply(message: PredictionsReply): void {
  self.postMessage(message);
}

self.onmessage = () => {
  loadEvents(getJson).then(
    ({ events, errors }) => {
      const [first] = errors;
      if (events.length > 0 || first === undefined) {
        reply({ type: 'events', events, loadedAt: Date.now(), partial: errors.length > 0 });
        return;
      }
      reply({
        type: 'error',
        status: first instanceof HttpFailure ? first.status : null,
        retryAt: first instanceof HttpFailure ? first.retryAt : null,
        // fetch rejects with a TypeError when the request never got an answer.
        offline: first instanceof TypeError,
        message: first instanceof Error ? first.message : 'Polymarket unavailable',
      });
    },
    (error: unknown) => {
      reply({
        type: 'error',
        status: null,
        retryAt: null,
        offline: false,
        message: error instanceof Error ? error.message : 'Polymarket unavailable',
      });
    },
  );
};
