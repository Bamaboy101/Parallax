import { Clock } from './Clock';
import { DockArea } from './DockArea';

/** Top bar, dock area, ticker rail. */
export function Shell() {
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-bg">
      <header className="flex h-9 items-center gap-4 border-b border-line px-3">
        <h1 className="text-label font-medium tracking-wider text-text uppercase">Open Terminal</h1>
        <div className="ml-auto flex items-center gap-4">
          <Clock />
        </div>
      </header>
      <main className="min-h-0 p-1">
        <DockArea />
      </main>
      <footer aria-label="Ticker rail" className="h-8 border-t border-line" />
    </div>
  );
}
