import type { AdapterContext } from '../types';

/** The part of WebSocket the adapters use, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export const browserSocket: SocketFactory = (url) => new WebSocket(url);

const OPEN = 1;

/**
 * One WebSocket connection, per the adapter contract: connect() settles when the socket closes.
 * Subclasses send subscriptions in onOpen() and parse frames in onMessage().
 */
export abstract class SocketAdapter {
  private socket: SocketLike | null = null;
  private disposed = false;
  private keepAliveTimer: number | undefined;

  protected constructor(
    protected readonly ctx: AdapterContext,
    private readonly createSocket: SocketFactory,
  ) {}

  protected abstract readonly url: string;
  protected abstract onOpen(): void;
  protected abstract onMessage(text: string, receivedAt: number): void;

  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      socket.onopen = () => {
        this.onOpen();
      };
      socket.onmessage = (event: MessageEvent) => {
        const receivedAt = Date.now();
        if (typeof event.data !== 'string') return;
        try {
          this.onMessage(event.data, receivedAt);
        } catch (error) {
          this.ctx.log(
            'warn',
            `unreadable message: ${error instanceof Error ? error.message : ''}`,
          );
        }
      };
      socket.onclose = (event: CloseEvent) => {
        this.socket = null;
        globalThis.clearInterval(this.keepAliveTimer);
        if (this.disposed || event.code === 1000) resolve();
        else reject(new Error(`socket closed with code ${String(event.code)}`));
      };
    });
  }

  dispose(): void {
    this.disposed = true;
    globalThis.clearInterval(this.keepAliveTimer);
    this.socket?.close();
  }

  protected get isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  protected send(message: unknown): void {
    if (this.isOpen) this.socket?.send(JSON.stringify(message));
  }

  /** Close from our side, e.g. on a server shutdown notice; the hub reconnects. */
  protected close(): void {
    this.socket?.close();
  }

  /** Send `message` every `ms` while the socket is open. */
  protected keepAlive(ms: number, message: unknown): void {
    globalThis.clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = globalThis.setInterval(() => {
      this.send(message);
    }, ms);
  }
}
