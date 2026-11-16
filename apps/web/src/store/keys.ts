import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const KEYS_STORAGE_KEY = 'open-terminal:keys';

interface KeyVault {
  /**
   * The user's keys by provider id, exactly as adapters receive them from `getKey`. They stay in
   * this browser and go only to their own provider, through the feed hub.
   */
  keys: Readonly<Record<string, string>>;
  /** Store a key, or remove it with an empty string. */
  setKey: (provider: string, key: string) => void;
}

export const useKeyVault = create<KeyVault>()(
  persist(
    (set) => ({
      keys: {},
      setKey: (provider, key) => {
        set((state) => ({
          keys: Object.fromEntries([
            ...Object.entries(state.keys).filter(([name]) => name !== provider),
            ...(key === '' ? [] : [[provider, key] as const]),
          ]),
        }));
      },
    }),
    {
      name: KEYS_STORAGE_KEY,
      version: 1,
      // Blocked storage leaves the vault working for this visit only.
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ keys: state.keys }),
    },
  ),
);
