interface SparklineProps {
  values: readonly number[];
  tone: 'up' | 'down' | 'neutral';
  width?: number;
  height?: number;
}

const strokeClass = { up: 'stroke-up', down: 'stroke-down', neutral: 'stroke-muted' } as const;

/** A tiny line chart of recent values. Empty until there are two points. */
export function Sparkline({ values, tone, width = 64, height = 20 }: SparklineProps) {
  if (values.length < 2) return <svg aria-hidden width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - 1 - ((value - min) / span) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.25"
        strokeLinejoin="round"
        className={strokeClass[tone]}
      />
    </svg>
  );
}
