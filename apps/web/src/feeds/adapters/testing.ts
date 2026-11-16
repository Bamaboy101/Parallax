import type { AdapterContext, FeedAdapter, FeedEvent } from '../types';
import type { SocketFactory, SocketLike } from './socket';

/** In-memory WebSocket for adapter tests: records sent frames and replays recorded ones. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(text: string): void {
    this.onmessage?.(new MessageEvent('message', { data: text }));
  }

  /** Feed every line of a recorded `.jsonl` file. */
  replay(recording: string): void {
    for (const line of recording.split('\n')) if (line.trim() !== '') this.receive(line);
  }
}

/** Build an adapter wired to a fake socket and an event collector, with optional stored keys. */
export function harness<A extends FeedAdapter>(
  create: (ctx: AdapterContext, createSocket: SocketFactory) => A,
  keys: Readonly<Record<string, string>> = {},
) {
  const events: FeedEvent[] = [];
  const logs: string[] = [];
  const sockets: FakeSocket[] = [];
  const adapter = create(
    {
      emit: (event) => events.push(event),
      getKey: (provider) => keys[provider],
      log: (level, message) => logs.push(`${level}: ${message}`),
    },
    (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  );
  const socket = () => {
    const latest = sockets.at(-1);
    if (!latest) throw new Error('connect() has not opened a socket');
    return latest;
  };
  const byChannel = <C extends FeedEvent['channel']>(channel: C) =>
    events.filter(
      (event): event is Extract<FeedEvent, { channel: C }> => event.channel === channel,
    );
  return { adapter, events, logs, socket, byChannel };
}
