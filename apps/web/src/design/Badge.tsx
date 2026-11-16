import { badgeLabel, badgeTone, type BadgeTone, type Freshness } from './format';

const toneClass: Record<BadgeTone, string> = {
  live: 'border-live/20 bg-live/5 text-live',
  warn: 'border-warn/20 bg-warn/5 text-warn',
  offline: 'border-line bg-bg text-muted',
};

interface BadgeProps {
  freshness: Freshness;
  /** Adapter id, e.g. "binance". */
  source: string;
}

/** Truth badge: data freshness plus source, on every widget header. */
export function Badge({ freshness, source }: BadgeProps) {
  const tone = badgeTone(freshness);
  const label = badgeLabel(freshness);
  return (
    <span
      data-tone={tone}
      data-state={freshness.kind}
      title={`${label} · ${source}`}
      role="img"
      aria-label={`${label} · ${source}`}
      className={`truth-badge inline-flex shrink-0 items-center gap-1 rounded-full border px-1 font-mono text-label leading-none tabular-nums whitespace-nowrap ${toneClass[tone]}`}
    >
      <span aria-hidden className="truth-badge-mark" />
      <span className="truth-badge-label">{label}</span>
      <span aria-hidden className="truth-badge-divider h-2 w-px bg-current opacity-20" />
      <span className="truth-badge-source font-sans text-muted">{source}</span>
    </span>
  );
}
