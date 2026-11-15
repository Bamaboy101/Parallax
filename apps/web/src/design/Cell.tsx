import { useEffect, useRef } from 'react';
import { formatNumber } from './format';
import { pulse as pulseElement } from './pulse';

export type CellTone = 'up' | 'down' | 'neutral';

const toneClass: Record<CellTone, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-text',
};

interface CellProps {
  value: number | null | undefined;
  decimals?: number;
  /** Show a leading + on positive values (changes, deltas). */
  signed?: boolean;
  suffix?: string;
  tone?: CellTone;
  className?: string;
  /** Wash the cell up or down when the value changes. */
  pulse?: boolean;
}

/** A number in JetBrains Mono with tabular figures, so columns never jitter. */
export function Cell({
  value,
  decimals = 2,
  signed = false,
  suffix,
  tone = 'neutral',
  className = '',
  pulse = false,
}: CellProps) {
  const empty = value == null || !Number.isFinite(value);
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (!pulse || before == null || value == null || before === value || !ref.current) return;
    pulseElement(ref.current, value > before ? 'up' : 'down');
  }, [value, pulse]);
  return (
    <span
      ref={ref}
      data-tone={tone}
      className={`inline-block text-right font-mono text-num leading-none tabular-nums whitespace-nowrap ${empty ? 'text-muted' : toneClass[tone]} ${className}`}
    >
      {formatNumber(value, decimals, signed)}
      {!empty && suffix}
    </span>
  );
}
