import { create } from 'zustand';
import { isObject } from '../feeds/adapters/parse';
import type { BookEvent, FeedEvent, Level } from '../feeds/types';
import { ingest, REWIND_MS, resetTicks, setCursor, useTickStore } from './ticks';

/**
 * F10 session recorder. Records the market events the page receives (trades, quotes, bars, books,
 * funding, liquidations: market data only, never keys or settings), exports them as a file, and
 * replays a file through Rewind: the recording is loaded into the tick store as if it had just
 * happened, and the Rewind cursor plays it back.
 */

/** Longest recording: Rewind reaches an hour back, so a replay of up to an hour fits in it. */
export const RECORD_LIMIT_MS = REWIND_MS;
/** Most events in one recording (about 60 MB in memory, a few MB gzipped). */
export const RECORD_EVENT_LIMIT = 500_000;
/** Replay speeds offered. */
export const REPLAY_SPEEDS = [1, 4, 16] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
/** How often a playing replay moves the cursor. */
const PLAY_STEP_MS = 250;

export interface Recording {
  app: 'parallax';
  kind: 'session';
  v: 1;
  /** Local epoch ms of the first and last moment recorded. */
  from: number;
  to: number;
  events: FeedEvent[];
}

export interface ReplayState {
  /** When the recording was made (original times). */
  from: number;
  to: number;
  /** Where it sits in the tick store: shifted so it ends when the replay started. */
  start: number;
  end: number;
  playing: boolean;
  speed: ReplaySpeed;
}

interface RecorderState {
  mode: 'idle' | 'recording' | 'replaying';
  /** While recording: when it started and how many events so far. */
  startedAt: number | null;
  count: number;
  /** The last finished or opened recording, ready to export or replay. */
  recording: Recording | null;
  replay: ReplayState | null;
  /** Why recording stopped by itself, or why a file could not be opened. */
  notice: string | null;
}

export const useRecorder = create<RecorderState>()(() => ({
  mode: 'idle',
  startedAt: null,
  count: 0,
  recording: null,
  replay: null,
  notice: null,
}));

let buffer: FeedEvent[] = [];
let playTimer: number | undefined;

export const isReplaying = (): boolean => useRecorder.getState().mode === 'replaying';

/** Books start from a snapshot: give the recording one for every book the page holds now. */
function bookSnapshots(now: number): BookEvent[] {
  return Object.values(useTickStore.getState().latest.book).map((view) => ({
    channel: 'book',
    kind: 'snapshot',
    symbol: view.symbol,
    source: view.source,
    ts: view.ts,
    receivedAt: now,
    bids: view.bids.map(([price, size]): Level => [price, size]),
    asks: view.asks.map(([price, size]): Level => [price, size]),
  }));
}

export function startRecording(now = Date.now()): void {
  if (useRecorder.getState().mode !== 'idle') return;
  buffer = bookSnapshots(now);
  useRecorder.setState({ mode: 'recording', startedAt: now, count: buffer.length, notice: null });
}

export function stopRecording(now = Date.now(), notice: string | null = null): void {
  const { mode, startedAt } = useRecorder.getState();
  if (mode !== 'recording' || startedAt === null) return;
  const recording: Recording = {
    app: 'parallax',
    kind: 'session',
    v: 1,
    from: startedAt,
    to: now,
    events: buffer,
  };
  buffer = [];
  useRecorder.setState({ mode: 'idle', startedAt: null, count: 0, recording, notice });
}

/** Called by the feed client with every batch from the hub. */
export function captureEvents(events: readonly FeedEvent[], now = Date.now()): void {
  const { mode, startedAt } = useRecorder.getState();
  if (mode !== 'recording' || startedAt === null) return;
  for (const event of events) buffer.push(event);
  if (now - startedAt >= RECORD_LIMIT_MS) {
    stopRecording(now, 'Recording stopped at one hour, the longest a replay can show.');
  } else if (buffer.length >= RECORD_EVENT_LIMIT) {
    stopRecording(
      now,
      `Recording stopped at ${RECORD_EVENT_LIMIT.toLocaleString()} market events.`,
    );
  } else {
    useRecorder.setState({ count: buffer.length });
  }
}

const CHANNELS = new Set(['trade', 'quote', 'bar', 'book', 'deriv', 'liquidation']);
const isLevel = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number';

/** One event from a file, checked enough that the store can use it; null otherwise. */
function eventOf(value: unknown): FeedEvent | null {
  if (
    !isObject(value) ||
    typeof value.channel !== 'string' ||
    !CHANNELS.has(value.channel) ||
    typeof value.symbol !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.ts !== 'number' ||
    typeof value.receivedAt !== 'number'
  )
    return null;
  if (
    value.channel === 'book' &&
    (!Array.isArray(value.bids) ||
      !Array.isArray(value.asks) ||
      !value.bids.every(isLevel) ||
      !value.asks.every(isLevel))
  )
    return null;
  const numbers: Record<string, readonly string[]> = {
    trade: ['price', 'size'],
    quote: ['bid', 'ask'],
    bar: ['open', 'high', 'low', 'close'],
    deriv: ['markPrice', 'fundingRate'],
    liquidation: ['price', 'size'],
    book: [],
  };
  for (const field of numbers[value.channel] ?? []) {
    if (typeof value[field] !== 'number') return null;
  }
  return value as unknown as FeedEvent;
}

/** A recording file's content; null when it is not one. */
export function parseRecording(value: unknown): Recording | null {
  if (
    !isObject(value) ||
    value.app !== 'parallax' ||
    value.kind !== 'session' ||
    value.v !== 1 ||
    typeof value.from !== 'number' ||
    typeof value.to !== 'number' ||
    value.to < value.from ||
    value.to - value.from > RECORD_LIMIT_MS ||
    !Array.isArray(value.events) ||
    value.events.length > RECORD_EVENT_LIMIT
  )
    return null;
  const events: FeedEvent[] = [];
  for (const entry of value.events) {
    const event = eventOf(entry);
    if (!event) return null;
    events.push(event);
  }
  return { app: 'parallax', kind: 'session', v: 1, from: value.from, to: value.to, events };
}

const GZIP_MAGIC = [0x1f, 0x8b];

/** Bytes through a (de)compression stream. */
async function transform(
  input: BodyInit,
  stream: CompressionStream | DecompressionStream,
): Promise<ArrayBuffer> {
  const body = new Response(input).body;
  if (!body) throw new Error('empty input');
  return new Response(body.pipeThrough(stream)).arrayBuffer();
}

/** The recording as a gzipped JSON file. */
export async function recordingFile(recording: Recording): Promise<Blob> {
  const gzipped = await transform(JSON.stringify(recording), new CompressionStream('gzip'));
  return new Blob([gzipped], { type: 'application/gzip' });
}

/** 'parallax-session-2026-11-18-1402.json.gz' */
export function recordingName(recording: Pick<Recording, 'from'>): string {
  const at = new Date(recording.from);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `parallax-session-${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.json.gz`;
}

/** Open a recording file (gzipped or plain JSON). Keeps it ready to replay. */
export async function openRecording(file: Blob): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
    const text = new TextDecoder().decode(
      gzipped ? await transform(bytes, new DecompressionStream('gzip')) : bytes,
    );
    const recording = parseRecording(JSON.parse(text));
    if (!recording) throw new Error('not a Parallax session file');
    useRecorder.setState({ recording, notice: null });
    return true;
  } catch {
    useRecorder.setState({
      notice: 'That file is not a Parallax session recording (or it is longer than an hour).',
    });
    return false;
  }
}

/**
 * Replay the recording: the tick store is emptied, live market events are set aside, and the
 * recording is loaded with its times shifted so it ends now; Rewind then sits at its start.
 */
export function startReplay(now = Date.now()): void {
  const { recording, mode } = useRecorder.getState();
  if (!recording || mode !== 'idle') return;
  const shift = now - recording.to;
  // Keep the feeds' statuses: they still describe the live connections behind the page.
  const status = useTickStore.getState().status;
  resetTicks();
  useTickStore.setState({ status });
  useRecorder.setState({
    mode: 'replaying',
    replay: {
      from: recording.from,
      to: recording.to,
      start: recording.from + shift,
      end: now,
      playing: false,
      speed: 1,
    },
    notice: null,
  });
  const shifted = recording.events.map((event): FeedEvent => ({
    ...event,
    ts: event.ts + shift,
    receivedAt: event.receivedAt + shift,
  }));
  // Bars keep their open time on the minute grid of the recording, shifted with it.
  for (let index = 0; index < shifted.length; index += 5_000) {
    ingest(shifted.slice(index, index + 5_000));
  }
  setCursor(recording.from + shift);
}

function stopPlaying(): void {
  if (playTimer !== undefined) window.clearInterval(playTimer);
  playTimer = undefined;
}

/** Play from the cursor (or from the start, if it is at the end) at a speed, up to the end. */
export function playReplay(speed: ReplaySpeed): void {
  const { replay } = useRecorder.getState();
  if (!replay) return;
  stopPlaying();
  if (useTickStore.getState().cursor === null) setCursor(replay.start);
  useRecorder.setState({ replay: { ...replay, playing: true, speed } });
  playTimer = window.setInterval(() => {
    const current = useRecorder.getState().replay;
    if (!current) {
      stopPlaying();
      return;
    }
    const cursor = useTickStore.getState().cursor ?? current.end;
    const next = cursor + PLAY_STEP_MS * current.speed;
    if (next >= current.end) {
      setCursor(null);
      stopPlaying();
      useRecorder.setState({ replay: { ...current, playing: false } });
      return;
    }
    setCursor(next);
  }, PLAY_STEP_MS);
}

export function pauseReplay(): void {
  stopPlaying();
  const { replay } = useRecorder.getState();
  if (replay) useRecorder.setState({ replay: { ...replay, playing: false } });
}

/**
 * Back to live. Live events were set aside during the replay, so books and history would be
 * incomplete: reloading the page reconnects every feed from a fresh snapshot. The layout is saved.
 */
export function endReplay(
  reload: () => void = () => {
    window.location.reload();
  },
): void {
  stopPlaying();
  useRecorder.setState({ mode: 'idle', replay: null });
  reload();
}
