import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const AI_KEYS_STORAGE_KEY = 'open-terminal:ai-keys';

export type AiProvider = 'anthropic' | 'openai';

interface AiKeyVault {
  /** The user's own AI keys. They stay in this browser and go only to their own provider. */
  keys: Readonly<Partial<Record<AiProvider, string>>>;
  provider: AiProvider;
  /** The model chosen per provider, from the provider's own model list. */
  models: Readonly<Partial<Record<AiProvider, string>>>;
  setKey: (provider: AiProvider, key: string) => void;
  setProvider: (provider: AiProvider) => void;
  setModel: (provider: AiProvider, model: string) => void;
}

/**
 * Separate from the data-key vault (store/keys.ts) on purpose: data keys are handed to the feed
 * hub worker, AI keys never are. Each is read only by its provider's client (providers.ts).
 */
export const useAiKeys = create<AiKeyVault>()(
  persist(
    (set) => ({
      keys: {},
      provider: 'anthropic',
      models: {},
      setKey: (provider, key) => {
        set((state) => {
          const trimmed = key.trim();
          const keys = Object.fromEntries(
            Object.entries(state.keys).filter(([id]) => id !== provider),
          );
          if (trimmed !== '') keys[provider] = trimmed;
          return { keys };
        });
      },
      setProvider: (provider) => {
        set({ provider });
      },
      setModel: (provider, model) => {
        set((state) => ({ models: { ...state.models, [provider]: model } }));
      },
    }),
    {
      name: AI_KEYS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ keys: state.keys, provider: state.provider, models: state.models }),
    },
  ),
);
