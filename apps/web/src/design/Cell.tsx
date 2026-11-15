import { formatNumber } from './format';

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
}

/** A number in JetBrains Mono with tabular figures, so columns never jitter. */
export function Cell({
  value,
  decimals = 2,
  signed = false,
  suffix,
  tone = 'neutral',
  className = '',
}: CellProps) {
  const empty = value == null || !Number.isFinite(value);
  return (
    <span
      data-tone={tone}
      className={`inline-block text-right font-mono text-num leading-none tabular-nums whitespace-nowrap ${empty ? 'text-muted' : toneClass[tone]} ${className}`}
    >
      {formatNumber(value, decimals, signed)}
      {!empty && suffix}
    </span>
  );
}
