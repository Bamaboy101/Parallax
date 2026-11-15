import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const LAYOUT_STORAGE_KEY = 'open-terminal:layout';

interface LayoutState {
  /** Last saved dock layout, or null for the default layout. */
  dock: SerializedDockview | null;
  saveDock: (dock: SerializedDockview) => void;
  resetDock: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      dock: null,
      saveDock: (dock) => {
        set({ dock });
      },
      resetDock: () => {
        set({ dock: null });
      },
    }),
    {
      name: LAYOUT_STORAGE_KEY,
      // Bumped whenever the default panels change; older saved layouts give way to the default.
      // v2: watchlist and tape. v3: chart. v4: order book.
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dock: state.dock }),
    },
  ),
);
