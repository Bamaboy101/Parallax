import { Clock } from './Clock';
import { DockArea } from './DockArea';

/** Top bar, dock area, ticker rail. */
export function Shell() {
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-bg">
      <header className="shell-topbar">
        <div aria-hidden="true" className="shell-mark">
          <span />
        </div>
        <h1 className="text-ui font-medium tracking-tight text-text">Open Terminal</h1>
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <Clock />
        </div>
      </header>
      <main className="min-h-0 min-w-0 p-2">
        <DockArea />
      </main>
      <footer aria-label="Ticker rail" className="shell-rail">
        <span className="text-label text-muted">Drag tabs to arrange your desk</span>
      </footer>
    </div>
  );
}
