import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const LAYOUT_STORAGE_KEY = 'parallax:layout';

/**
 * Which saved layout the dock uses: Pro's, Simple's (E2), or Simple's on a phone (E5: one
 * full-width group of tabs), so no one of them ever rearranges another.
 */
export type LayoutSlot = 'pro' | 'simple' | 'phone';

interface LayoutState {
  /** Last saved Pro dock layout, or null for the default layout. */
  dock: SerializedDockview | null;
  simpleDock: SerializedDockview | null;
  phoneDock: SerializedDockview | null;
  saveDock: (dock: SerializedDockview, slot: LayoutSlot) => void;
}

const FIELD = { pro: 'dock', simple: 'simpleDock', phone: 'phoneDock' } as const;

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      dock: null,
      simpleDock: null,
      phoneDock: null,
      saveDock: (dock, slot) => {
        set({ [FIELD[slot]]: dock });
      },
    }),
    {
      name: LAYOUT_STORAGE_KEY,
      // Bumped whenever the default panels change; older saved layouts give way to the default.
      // v2: watchlist and tape. v3: chart. v4: order book.
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        dock: state.dock,
        simpleDock: state.simpleDock,
        phoneDock: state.phoneDock,
      }),
    },
  ),
);

/** The saved layout for a slot. */
export const savedDock = (state: LayoutState, slot: LayoutSlot): SerializedDockview | null =>
  state[FIELD[slot]];
