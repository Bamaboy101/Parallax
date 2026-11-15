/**
 * Readers for untyped provider JSON. Each throws on a missing or malformed field; SocketAdapter
 * catches and logs, so one bad frame never takes a connection down.
 */

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a frame that must be a JSON object. */
export function parseFrame(text: string): Json {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error('frame is not an object');
  return value;
}

export function str(source: Json, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new Error(`${key} is not a string`);
  return value;
}

/** A number, or a numeric string as most exchanges send prices. */
export function num(value: unknown, key = 'value'): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed))
    throw new Error(`${key} is not a number`);
  return parsed;
}

export function field(source: Json, key: string): number {
  return num(source[key], key);
}

export function obj(source: Json, key: string): Json {
  const value = source[key];
  if (!isObject(value)) throw new Error(`${key} is not an object`);
  return value;
}

export function list(source: Json, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) throw new Error(`${key} is not a list`);
  return value;
}

/** RFC 3339 timestamp → epoch ms. */
export function time(source: Json, key: string): number {
  const ms = Date.parse(str(source, key));
  if (Number.isNaN(ms)) throw new Error(`${key} is not a timestamp`);
  return ms;
}

/** `[["price", "size"], ...]` → `[[price, size], ...]`. */
export function levels(value: unknown[]): [number, number][] {
  return value.map((entry) => {
    if (!Array.isArray(entry)) throw new Error('level is not a pair');
    return [num(entry[0], 'price'), num(entry[1], 'size')];
  });
}
