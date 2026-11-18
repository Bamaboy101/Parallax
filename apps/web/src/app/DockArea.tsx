import { ParallaxMark } from '../design/ParallaxMark';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
} from 'dockview-react';
import { useEffect, useRef, useState } from 'react';
import { savedDock, useLayoutStore, type LayoutSlot } from '../store/layout';
import { DEFAULT_WORKSPACE, SIMPLE_WORKSPACE } from '../workspaces';
import { setDockApi } from './dockApi';
import { restoreLayout, setTabbedPresets } from './dockLayout';
import { useLinkFollower } from './links';
import { PanelBadges } from './PanelBadges';
import { DOCK_COMPONENTS } from './widgets';
import { openSharedWorkspace } from './workspace';

const SAVE_DELAY_MS = 250;
const BOOT_KEY = 'parallax:cockpit-boot';
let bootShown = false;

const cockpitTheme: DockviewTheme = {
  name: 'cockpit',
  className: 'dockview-theme-cockpit',
  gap: 4,
};

/**
 * The dock. Each layout slot has its own saved layout: Pro starts from Mission Control, Simple
 * (E2) from the `simple` preset, and Simple on a phone (E5) from the same preset laid out as tabs
 * in one full-width group. The shell remounts it when the slot changes.
 */
export function DockArea({ slot }: { slot: LayoutSlot }) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  /** F9: the browser refused to open a window for a panel. */
  const [popoutBlocked, setPopoutBlocked] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const bootHint = useRef<HTMLButtonElement>(null);
  useLinkFollower(api);
  // The Rundown unmounts the dock; commands then wait for it (see runCommand).
  useEffect(
    () => () => {
      setDockApi(null);
    },
    [],
  );

  const onReady = (event: DockviewReadyEvent) => {
    setTabbedPresets(slot === 'phone');
    restoreLayout(
      event.api,
      savedDock(useLayoutStore.getState(), slot),
      slot === 'pro' ? DEFAULT_WORKSPACE : SIMPLE_WORKSPACE,
    );
    setDockApi(event.api);
    setApi(event.api);
    // A share link replaces the restored layout once it has been decoded.
    void openSharedWorkspace(event.api, window.location, window.history);
  };

  // Persist the layout: debounced while dragging, flushed when the page is hidden.
  useEffect(() => {
    if (!api) return;
    const { saveDock } = useLayoutStore.getState();
    let timer: number | undefined;
    const flush = () => {
      window.clearTimeout(timer);
      timer = undefined;
      saveDock(api.toJSON(), slot);
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
  }, [api, slot]);

  useEffect(() => {
    if (!api) return;
    const failure = api.onDidOpenPopoutWindowFail(() => {
      setPopoutBlocked(true);
    });
    return () => {
      failure.dispose();
    };
  }, [api]);

  useEffect(() => {
    const root = surface.current;
    if (!api || !root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let seen = bootShown;
    try {
      seen ||= sessionStorage.getItem(BOOT_KEY) === '1';
      sessionStorage.setItem(BOOT_KEY, '1');
    } catch {
      // Memory guard still prevents replays when session storage is blocked.
    }
    bootShown = true;
    const animations: Animation[] = [];
    const finish = () => {
      for (const animation of animations) animation.cancel();
      if (bootHint.current) bootHint.current.hidden = true;
    };
    if (!seen && !reduced.matches) {
      const groups = [...root.querySelectorAll<HTMLElement>('.dv-groupview')];
      groups.forEach((group, index) => {
        // Actual panels and their actual badges; never imply that a feed is connected.
        animations.push(
          group.animate([{ opacity: 0.15 }, { opacity: 1 }], {
            duration: 160,
            delay: (index / Math.max(1, groups.length - 1)) * 800,
            fill: 'backwards',
            easing: 'ease-out',
          }),
        );
      });
      if (bootHint.current) bootHint.current.hidden = false;
    }
    const timer = window.setTimeout(finish, 980);
    window.addEventListener('pointerdown', finish, true);
    window.addEventListener('keydown', finish, true);
    reduced.addEventListener('change', finish);

    // A sustained missed frame budget disables glass for this dock lifetime.
    // Ignore background-tab gaps and isolated GC/network scheduling stalls.
    let frame = 0;
    let previous = 0;
    let count = 0;
    let slow = 0;
    const measure = (now: number) => {
      if (document.hidden) {
        previous = 0;
        count = 0;
        slow = 0;
      } else {
        if (previous !== 0) {
          count += 1;
          if (now - previous > 22) slow += 1;
        }
        previous = now;
        if (count >= 120) {
          if (slow > 12) {
            root.dataset.render = 'solid';
            return;
          }
          count = 0;
          slow = 0;
        }
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      finish();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', finish, true);
      window.removeEventListener('keydown', finish, true);
      reduced.removeEventListener('change', finish);
    };
  }, [api]);

  return (
    <div ref={surface} className="dock-cockpit">
      <DockviewReact
        className="h-full"
        theme={cockpitTheme}
        components={DOCK_COMPONENTS}
        rightHeaderActionsComponent={PanelBadges}
        onReady={onReady}
      />
      {popoutBlocked && (
        <p className="dock-popout-blocked" role="alert">
          The browser blocked the new window. Allow pop-ups for this site, then press the window
          button again.
          <button
            type="button"
            className="chart-interval"
            onClick={() => {
              setPopoutBlocked(false);
            }}
          >
            OK
          </button>
        </p>
      )}
      <button ref={bootHint} type="button" className="cockpit-boot" hidden>
        <ParallaxMark />
        Initialising panels · click or press any key to skip
      </button>
    </div>
  );
}
