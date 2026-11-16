import type { PredictionEvent } from './classify';

/** What the predictions worker posts back after each refresh request. */
export type PredictionsReply =
  | {
      type: 'events';
      events: PredictionEvent[];
      loadedAt: number;
      /** Some tag queries failed; the events are what the rest returned. */
      partial: boolean;
    }
  | {
      type: 'error';
      /** HTTP status when Polymarket answered, else null. */
      status: number | null;
      retryAt: number | null;
      offline: boolean;
      message: string;
    };
