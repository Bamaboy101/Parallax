import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PREFS_STORAGE_KEY = 'open-terminal:prefs';

/** Green up / red down, or blue up / orange down for colour-blind users and red-means-up markets. */
export type Palette = 'green-red' | 'blue-orange';
export type Density = 'comfortable' | 'dense';

interface Prefs {
  palette: Palette;
  density: Density;
  setPalette: (palette: Palette) => void;
  setDensity: (density: Density) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      palette: 'green-red',
      density: 'comfortable',
      setPalette: (palette) => {
        set({ palette });
      },
      setDensity: (density) => {
        set({ density });
      },
    }),
    {
      name: PREFS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ palette: state.palette, density: state.density }),
    },
  ),
);

/** The tokens read `data-palette` and `data-density` on <html>; defaults carry no attribute. */
function apply({ palette, density }: Pick<Prefs, 'palette' | 'density'>): void {
  const root = document.documentElement;
  if (palette === 'blue-orange') root.dataset.palette = palette;
  else delete root.dataset.palette;
  if (density === 'dense') root.dataset.density = density;
  else delete root.dataset.density;
}

/** Apply saved preferences now and follow every change. Called once, before the first render. */
export function applyPrefs(): void {
  apply(usePrefs.getState());
  usePrefs.subscribe(apply);
}
