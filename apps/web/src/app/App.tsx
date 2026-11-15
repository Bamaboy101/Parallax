import { Badge } from '../design/Badge';
import { Cell } from '../design/Cell';
import { Panel } from '../design/Panel';

// Primitives preview with sample values. T3 replaces this with the shell.
export function App() {
  return (
    <main className="min-h-screen p-4">
      <h1 className="mb-4 text-label tracking-wider text-muted uppercase">Open Terminal</h1>
      <div className="grid max-w-3xl grid-cols-2 gap-2">
        <Panel title="Badges">
          <div className="flex flex-col items-start gap-2 p-(--pad)">
            <Badge freshness={{ kind: 'live', ageMs: 140 }} source="binance" />
            <Badge freshness={{ kind: 'live', ageMs: 8400, stale: true }} source="kraken" />
            <Badge freshness={{ kind: 'delayed', minutes: 15 }} source="finnhub" />
            <Badge freshness={{ kind: 'eod' }} source="fred" />
            <Badge freshness={{ kind: 'offline' }} source="alpaca" />
          </div>
        </Panel>
        <Panel
          title="Cells"
          badge={<Badge freshness={{ kind: 'live', ageMs: 90 }} source="coinbase" />}
        >
          <div className="flex flex-col items-end gap-1 p-(--pad)">
            <Cell value={98234.5} />
            <Cell value={2.41} signed suffix="%" tone="up" />
            <Cell value={-0.87} signed suffix="%" tone="down" />
            <Cell value={null} />
          </div>
        </Panel>
      </div>
    </main>
  );
}
