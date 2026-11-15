import type { DockviewApi } from 'dockview-react';

let current: DockviewApi | null = null;

/** Set by DockArea once dockview is ready, so commands can open and retarget panels. */
export function setDockApi(api: DockviewApi | null): void {
  current = api;
}

export function dockApi(): DockviewApi | null {
  return current;
}
