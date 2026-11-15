/** Anything kept for Rewind carries the local time it arrived. */
export interface Timed {
  receivedAt: number;
}

/**
 * Fixed-capacity circular buffer ordered by arrival time. Pushing past capacity drops the oldest
 * item; `evictBefore` drops items older than the retention window. Lookups by time are binary
 * searches, so Rewind can find "the latest item at 14:32" in O(log n).
 */
export class RingBuffer<T extends Timed> {
  private readonly items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Item at logical position `index` (0 = oldest). */
  private get(index: number): T {
    const item = this.items[(this.head + index) % this.capacity];
    if (item === undefined) throw new Error('ring buffer index out of range');
    return item;
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item;
      this.count += 1;
    } else {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  last(): T | undefined {
    return this.count === 0 ? undefined : this.get(this.count - 1);
  }

  /** Replace the newest item, e.g. a bar that is still forming. */
  replaceLast(item: T): void {
    if (this.count === 0) {
      this.push(item);
      return;
    }
    this.items[(this.head + this.count - 1) % this.capacity] = item;
  }

  /** Drop every item that arrived before `time`. */
  evictBefore(time: number): void {
    while (this.count > 0 && this.get(0).receivedAt < time) {
      this.items[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.count -= 1;
    }
  }

  /** Logical index of the newest item that arrived at or before `time`, or -1. */
  private indexAt(time: number): number {
    let low = 0;
    let high = this.count - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.get(mid).receivedAt <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /** The newest item at or before `time`; the newest item overall when `time` is null. */
  at(time: number | null): T | undefined {
    if (time === null) return this.last();
    const index = this.indexAt(time);
    return index < 0 ? undefined : this.get(index);
  }

  /** Up to `limit` items at or before `time` (null = now), newest first. */
  latest(limit: number, time: number | null = null): T[] {
    const end = time === null ? this.count - 1 : this.indexAt(time);
    const result: T[] = [];
    for (let index = end; index >= 0 && result.length < limit; index -= 1) {
      result.push(this.get(index));
    }
    return result;
  }

  /** Items that arrived in [from, to], oldest first. */
  range(from: number, to: number): T[] {
    const result: T[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const item = this.get(index);
      if (item.receivedAt > to) break;
      if (item.receivedAt >= from) result.push(item);
    }
    return result;
  }
}
