import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PREFS_STORAGE_KEY = 'parallax:prefs';

/** Green up / red down, or blue up / orange down for colour-blind users and red-means-up markets. */
export type Palette = 'green-red' | 'blue-orange';
export type Density = 'comfortable' | 'dense';

interface Prefs {
  palette: Palette;
  density: Density;
  /** Learn mode (F5): plain-language explanations on every panel, number and badge. */
  learn: boolean;
  /**
   * Voice commands (F6) may use the browser's online speech service, which hears the audio. Off
   * until the user agrees; on-device recognition never needs it.
   */
  voiceOnline: boolean;
  /** Sound layer (F12): short cues for alerts, whale prints and lost network. Off by default. */
  sound: boolean;
  /** Cue volume, 0..1. */
  soundVolume: number;
  setPalette: (palette: Palette) => void;
  setDensity: (density: Density) => void;
  setLearn: (learn: boolean) => void;
  setVoiceOnline: (voiceOnline: boolean) => void;
  setSound: (sound: boolean) => void;
  setSoundVolume: (soundVolume: number) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      palette: 'green-red',
      density: 'comfortable',
      learn: false,
      voiceOnline: false,
      sound: false,
      soundVolume: 0.5,
      setPalette: (palette) => {
        set({ palette });
      },
      setDensity: (density) => {
        set({ density });
      },
      setLearn: (learn) => {
        set({ learn });
      },
      setVoiceOnline: (voiceOnline) => {
        set({ voiceOnline });
      },
      setSound: (sound) => {
        set({ sound });
      },
      setSoundVolume: (soundVolume) => {
        set({ soundVolume: Math.min(1, Math.max(0, soundVolume)) });
      },
    }),
    {
      name: PREFS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        palette: state.palette,
        density: state.density,
        learn: state.learn,
        voiceOnline: state.voiceOnline,
        sound: state.sound,
        soundVolume: state.soundVolume,
      }),
    },
  ),
);

/**
 * The tokens read `data-palette` and `data-density` on <html>, and learn mode's hints read
 * `data-learn`; defaults carry no attribute.
 */
function apply({ palette, density, learn }: Pick<Prefs, 'palette' | 'density' | 'learn'>): void {
  const root = document.documentElement;
  if (palette === 'blue-orange') root.dataset.palette = palette;
  else delete root.dataset.palette;
  if (density === 'dense') root.dataset.density = density;
  else delete root.dataset.density;
  if (learn) root.dataset.learn = 'on';
  else delete root.dataset.learn;
}

/** Apply saved preferences now and follow every change. Called once, before the first render. */
export function applyPrefs(): void {
  apply(usePrefs.getState());
  usePrefs.subscribe(apply);
}
