import type { DockviewApi } from 'dockview-react';

let current: DockviewApi | null = null;
let waiting: ((api: DockviewApi) => void)[] = [];

/** Set by DockArea once dockview is ready, so commands can open and retarget panels. */
export function setDockApi(api: DockviewApi | null): void {
  current = api;
  if (!api) return;
  const ready = waiting;
  waiting = [];
  for (const run of ready) run(api);
}

export function dockApi(): DockviewApi | null {
  return current;
}

/** Run once the dock is ready: now if it is mounted, else when the cockpit next opens. */
export function whenDockReady(run: (api: DockviewApi) => void): void {
  if (current) run(current);
  else waiting.push(run);
}
