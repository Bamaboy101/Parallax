import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const LAYOUT_STORAGE_KEY = 'parallax:layout';

interface LayoutState {
  /** Last saved Pro dock layout, or null for the default layout. */
  dock: SerializedDockview | null;
  /** E2: Simple mode's own layout, so switching modes never rearranges the Pro desk. */
  simpleDock: SerializedDockview | null;
  saveDock: (dock: SerializedDockview, mode: 'simple' | 'pro') => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      dock: null,
      simpleDock: null,
      saveDock: (dock, mode) => {
        set(mode === 'simple' ? { simpleDock: dock } : { dock });
      },
    }),
    {
      name: LAYOUT_STORAGE_KEY,
      // Bumped whenever the default panels change; older saved layouts give way to the default.
      // v2: watchlist and tape. v3: chart. v4: order book.
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dock: state.dock, simpleDock: state.simpleDock }),
    },
  ),
);
