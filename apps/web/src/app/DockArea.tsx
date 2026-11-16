import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
} from 'dockview-react';
import { useEffect, useState } from 'react';
import { useLayoutStore } from '../store/layout';
import { setDockApi } from './dockApi';
import { restoreLayout } from './dockLayout';
import { useLinkFollower } from './links';
import { PanelBadges } from './PanelBadges';
import { DOCK_COMPONENTS } from './widgets';

const SAVE_DELAY_MS = 250;

const cockpitTheme: DockviewTheme = {
  name: 'cockpit',
  className: 'dockview-theme-cockpit',
  gap: 4,
};

export function DockArea() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  useLinkFollower(api);

  const onReady = (event: DockviewReadyEvent) => {
    restoreLayout(event.api, useLayoutStore.getState().dock);
    setDockApi(event.api);
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
      components={DOCK_COMPONENTS}
      rightHeaderActionsComponent={PanelBadges}
      onReady={onReady}
    />
  );
}
