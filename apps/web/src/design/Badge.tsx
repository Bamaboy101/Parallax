import { badgeLabel, badgeTone, type BadgeTone, type Freshness } from './format';

const toneClass: Record<BadgeTone, string> = {
  live: 'border-live/40 text-live',
  warn: 'border-warn/40 text-warn',
  offline: 'border-line text-muted',
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
      title={`${label} · ${source}`}
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 font-mono text-label leading-none whitespace-nowrap ${toneClass[tone]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
      <span className="text-muted uppercase">{source}</span>
    </span>
  );
}
