import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubMessage, HubRequest, SourceStatus } from '../feeds/protocol';
import type { FeedEvent, TradeEvent } from '../feeds/types';
import { contextMessage } from './copilot/context';
import { connectFeed, disconnectFeed } from './feedClient';
import { useFreshness } from './panels';
import {
  captureEvents,
  endReplay,
  openRecording,
  parseRecording,
  RECORD_LIMIT_MS,
  recordingFile,
  startRecording,
  startReplay,
  stopRecording,
  useRecorder,
  type Recording,
} from './recorder';
import { ingest, resetTicks, setStatuses, useTickStore } from './ticks';

const T0 = Date.parse('2026-11-18T14:00:00Z');

const trade = (price: number, at: number): TradeEvent => ({
  channel: 'trade',
  symbol: 'BTC-USD',
  source: 'coinbase',
  ts: at,
  receivedAt: at,
  price,
  size: 0.5,
});

beforeEach(() => {
  resetTicks();
  useRecorder.setState({
    mode: 'idle',
    startedAt: null,
    count: 0,
    recording: null,
    replay: null,
    notice: null,
  });
});

afterEach(() => {
  disconnectFeed();
  vi.useRealTimers();
});

describe('recording', () => {
  it('keeps the events it sees, starting books from a snapshot', () => {
    ingest([
      {
        channel: 'book',
        kind: 'snapshot',
        symbol: 'BTC-USD',
        source: 'coinbase',
        ts: T0 - 5,
        receivedAt: T0 - 5,
        bids: [[64_000, 1]],
        asks: [[64_010, 2]],
      },
    ]);
    startRecording(T0);
    captureEvents([trade(64_005, T0 + 1000)], T0 + 1000);
    stopRecording(T0 + 2000);
    const { recording } = useRecorder.getState();
    expect(recording).toMatchObject({ from: T0, to: T0 + 2000 });
    expect(recording?.events.map((event) => event.channel)).toEqual(['book', 'trade']);
    expect(recording?.events[0]).toMatchObject({ kind: 'snapshot', bids: [[64_000, 1]] });
  });

  it('stops by itself at an hour, the longest a replay can show', () => {
    startRecording(T0);
    captureEvents([trade(1, T0 + RECORD_LIMIT_MS)], T0 + RECORD_LIMIT_MS);
    expect(useRecorder.getState().mode).toBe('idle');
    expect(useRecorder.getState().notice).toContain('one hour');
    expect(useRecorder.getState().recording?.events).toHaveLength(1);
  });

  it('records what the hub sends, and sets live events aside while replaying', () => {
    let deliver: ((event: MessageEvent<HubMessage>) => void) | null = null;
    connectFeed({
      postMessage: (message: HubRequest) => message,
      get onmessage() {
        return deliver;
      },
      set onmessage(handler) {
        deliver = handler;
      },
    });
    const send = (events: FeedEvent[]) => {
      deliver?.({ data: { type: 'events', events } } as MessageEvent<HubMessage>);
    };
    startRecording(Date.now());
    send([trade(100, Date.now())]);
    stopRecording(Date.now());
    expect(useRecorder.getState().recording?.events).toHaveLength(1);

    startReplay(Date.now());
    send([trade(999, Date.now())]);
    expect(useTickStore.getState().latest.trade['BTC-USD']?.price).toBe(100);
  });
});

describe('files', () => {
  const recording: Recording = {
    app: 'parallax',
    kind: 'session',
    v: 1,
    from: T0,
    to: T0 + 60_000,
    events: [trade(64_000, T0 + 1000)],
  };

  it('accepts only Parallax session recordings of up to an hour', () => {
    expect(parseRecording(recording)).toEqual(recording);
    expect(parseRecording({ ...recording, kind: 'workspace' })).toBeNull();
    expect(parseRecording({ ...recording, to: T0 + RECORD_LIMIT_MS + 1 })).toBeNull();
    expect(
      parseRecording({ ...recording, events: [{ channel: 'trade', symbol: 'X' }] }),
    ).toBeNull();
  });

  it('saves gzipped and opens again', async () => {
    const file = await recordingFile(recording);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(await openRecording(file)).toBe(true);
    expect(useRecorder.getState().recording).toEqual(recording);
    expect(await openRecording(new Blob(['{"app":"other"}']))).toBe(false);
    expect(useRecorder.getState().notice).toContain('not a Parallax session');
  });
});

describe('replay', () => {
  it('loads the recording so it ends now, starts Rewind at its beginning and says REPLAY', () => {
    const live: SourceStatus = {
      source: 'coinbase',
      state: 'live',
      lastEventAt: null,
      latencyMs: 80,
      stale: false,
      attempt: 0,
      retryAt: null,
      serving: ['BTC-USD'],
      symbolLimit: null,
      waiting: [],
      pollMs: null,
      key: null,
      rateLimited: false,
    };
    setStatuses([live]);
    useRecorder.setState({
      recording: {
        app: 'parallax',
        kind: 'session',
        v: 1,
        from: T0,
        to: T0 + 600_000,
        events: [trade(64_000, T0 + 1000), trade(64_100, T0 + 590_000)],
      },
    });
    const now = Date.now();
    startReplay(now);
    const shift = now - (T0 + 600_000);
    const state = useTickStore.getState();
    expect(state.cursor).toBe(T0 + shift);
    expect(state.latest.trade['BTC-USD']).toMatchObject({
      price: 64_100,
      receivedAt: T0 + 590_000 + shift,
    });
    expect(state.status.coinbase).toBeDefined();
    const { result } = renderHook(() => useFreshness(['coinbase']));
    expect(result.current).toEqual([{ kind: 'replay' }]);
    expect(contextMessage([], 'why?', now, state.cursor, useRecorder.getState().replay)).toContain(
      'REPLAY: the terminal is replaying a session recorded 2026-11-18 14:00 to 2026-11-18 14:10 UTC',
    );

    const reload = vi.fn();
    endReplay(reload);
    expect(reload).toHaveBeenCalledOnce();
    expect(useRecorder.getState().mode).toBe('idle');
  });
});
