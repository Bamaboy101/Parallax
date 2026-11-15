import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ringBuffer';

const item = (receivedAt: number) => ({ receivedAt });

describe('RingBuffer', () => {
  it('drops the oldest item past capacity', () => {
    const buffer = new RingBuffer<{ receivedAt: number }>(3);
    for (const t of [1, 2, 3, 4, 5]) buffer.push(item(t));
    expect(buffer.size).toBe(3);
    expect(buffer.latest(10).map((x) => x.receivedAt)).toEqual([5, 4, 3]);
  });

  it('finds the newest item at or before a moment', () => {
    const buffer = new RingBuffer<{ receivedAt: number }>(8);
    for (const t of [10, 20, 30, 40]) buffer.push(item(t));
    expect(buffer.at(5)).toBeUndefined();
    expect(buffer.at(10)?.receivedAt).toBe(10);
    expect(buffer.at(35)?.receivedAt).toBe(30);
    expect(buffer.at(null)?.receivedAt).toBe(40);
    expect(buffer.latest(2, 35).map((x) => x.receivedAt)).toEqual([30, 20]);
    expect(buffer.range(15, 35).map((x) => x.receivedAt)).toEqual([20, 30]);
  });

  it('evicts items older than the retention window, across the wrap point', () => {
    const buffer = new RingBuffer<{ receivedAt: number }>(4);
    for (const t of [1, 2, 3, 4, 5, 6]) buffer.push(item(t));
    buffer.evictBefore(5);
    expect(buffer.latest(10).map((x) => x.receivedAt)).toEqual([6, 5]);
    buffer.push(item(7));
    buffer.replaceLast(item(8));
    expect(buffer.latest(10).map((x) => x.receivedAt)).toEqual([8, 6, 5]);
  });
});
