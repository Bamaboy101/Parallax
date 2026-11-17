import type {
  DockviewApi,
  DockviewGroupPanel,
  SerializedDockview,
  SerializedFloatingGroup,
} from 'dockview-react';

/**
 * F9 multi-screen: a dock group moves to its own browser window (drag it to a second monitor)
 * and keeps working as before. The window shares this page's JavaScript, so its panels read the
 * same stores: linked panels stay linked, prices stay live, and nothing streams twice.
 */
export const POPOUT_URL = `${import.meta.env.BASE_URL}popout.html`;

/** The <html> attributes the design tokens and learn mode hang on. */
const MIRRORED = [
  'data-theme',
  'data-palette',
  'data-density',
  'data-learn',
  'data-render',
  'style',
];

/**
 * Keep a popout window's root in step with this page's: theme, palette, density, learn mode.
 * The window's document is read on every copy: dockview can hand the window over before
 * popout.html has replaced its initial blank document.
 */
export function mirrorRoot(target: Window, source: Document = document): () => void {
  const from = source.documentElement;
  const copy = () => {
    const to = target.document.documentElement;
    for (const name of MIRRORED) {
      const value = from.getAttribute(name);
      if (value === null) to.removeAttribute(name);
      else to.setAttribute(name, value);
    }
  };
  copy();
  target.addEventListener('load', copy);
  const observer = new MutationObserver(copy);
  observer.observe(from, { attributes: true, attributeFilter: MIRRORED });
  return () => {
    observer.disconnect();
    target.removeEventListener('load', copy);
  };
}

/** Move a group to a new window. Resolves false when the browser refused to open one. */
export function popOut(api: DockviewApi, group: DockviewGroupPanel): Promise<boolean> {
  let stop: (() => void) | undefined;
  return api.addPopoutGroup(group, {
    popoutUrl: POPOUT_URL,
    onDidOpen: ({ window }) => {
      stop = mirrorRoot(window);
    },
    onWillClose: () => {
      stop?.();
    },
  });
}

/** Where a reopened popout lands in the main window, cascading so none hide another. */
const FLOAT_ORIGIN = 48;
const FLOAT_STEP = 32;
const FLOAT_MAX = { width: 720, height: 520 };
const FLOAT_MIN = { width: 320, height: 240 };

/**
 * A saved layout with its popout windows turned into floating groups. Browsers only open windows
 * on a click, so reopening them on load would fail and could lose their panels; instead they come
 * back floating in the main window, one click from popping out again.
 */
export function popoutsAsFloating(saved: SerializedDockview): SerializedDockview {
  const popouts = saved.popoutGroups ?? [];
  if (popouts.length === 0) return saved;
  const floating = popouts.map((popout, index): SerializedFloatingGroup => {
    const offset = FLOAT_ORIGIN + index * FLOAT_STEP;
    const width = Math.min(FLOAT_MAX.width, Math.max(FLOAT_MIN.width, popout.position?.width ?? 0));
    const height = Math.min(
      FLOAT_MAX.height,
      Math.max(FLOAT_MIN.height, popout.position?.height ?? 0),
    );
    return {
      ...(popout.data ? { data: popout.data } : {}),
      ...(popout.grid ? { grid: popout.grid } : {}),
      position: { left: offset, top: offset, width, height },
    };
  });
  return {
    ...saved,
    popoutGroups: [],
    floatingGroups: [...(saved.floatingGroups ?? []), ...floating],
  };
}
