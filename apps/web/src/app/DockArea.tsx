import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react';
import { useEffect, useState } from 'react';
import { useLayoutStore } from '../store/layout';
import { restoreLayout } from './dockLayout';

const SAVE_DELAY_MS = 250;

const cockpitTheme: DockviewTheme = {
  name: 'cockpit',
  className: 'dockview-theme-cockpit',
  gap: 4,
};

function PlaceholderPanel({ api }: IDockviewPanelProps) {
  return (
    <div className="dock-placeholder">
      <span aria-hidden="true" className="dock-placeholder-mark" />
      <span className="text-ui font-medium text-muted">{api.title}</span>
      <span className="text-label text-muted">Empty panel</span>
    </div>
  );
}

const components = { placeholder: PlaceholderPanel };

export function DockArea() {
  const [api, setApi] = useState<DockviewApi | null>(null);

  const onReady = (event: DockviewReadyEvent) => {
    restoreLayout(event.api, useLayoutStore.getState().dock);
    setApi(event.api);
  };

  // Persist the layout: debounced while dragging, flushed when the page is hidden.
  useEffect(() => {
    if (!api) return;
    const { saveDock } = useLayoutStore.getState();
    let timer: number | undefined;
    const flush = () => {
      window.clearTimeout(timer);
      timer = undefined;
      saveDock(api.toJSON());
    };
    const subscription = api.onDidLayoutChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    });
    window.addEventListener('pagehide', flush);
    return () => {
      subscription.dispose();
      window.removeEventListener('pagehide', flush);
      if (timer !== undefined) flush();
    };
  }, [api]);

  return (
    <DockviewReact
      className="h-full"
      theme={cockpitTheme}
      components={components}
      onReady={onReady}
    />
  );
}
