import { create } from 'zustand';
import type { NewsItem } from '../../feeds/types';
import { parseCalendar, type Release } from '../calendar';
import { edgeJson } from '../edge';
import { failureOf } from '../failure';
import { cachedHistory } from '../history';
import { priceHistorySpan } from '../hooks';
import {
  CURVE_DAYS,
  CURVE_IDS,
  daysBefore,
  fetchFred,
  STAT_DAYS,
  STAT_IDS,
  type SeriesMap,
} from '../macro';
import { newsTarget } from '../news';
import { usePaperStore } from '../paper/store';
import { useOptionsSummaries } from '../options/store';
import { usePredictionStore } from '../predictions/store';
import { INSTRUMENTS } from '../symbols';
import { useTickStore } from '../ticks';
import { buildContext, contextMessage, type ContextItem, type PanelRef } from './context';
import {
  ADVICE_REFUSAL,
  ADVICE_WITHHELD,
  asksForAdvice,
  citedIds,
  givesAdvice,
  SYSTEM_PROMPT,
} from './guard';
import { useAiKeys, type AiProvider } from './keys';
import { askProvider, defaultModel, listModels } from './providers';

export interface CopilotAnswer {
  question: string;
  text: string;
  /** The panels, odds and headlines the answer cites, in order of use. */
  cited: ContextItem[];
  /** Everything the co-pilot was given, for "what it saw". */
  context: ContextItem[];
  provider: AiProvider;
  model: string;
  at: number;
}

/** One question's outcome. Each co-pilot panel keeps its own. */
export type CopilotResult =
  | { status: 'answered'; answer: CopilotAnswer }
  | { status: 'refused' | 'withheld' | 'error'; message: string };

export interface CopilotModels {
  /** Models each provider offers this key, newest first. */
  models: Partial<Record<AiProvider, string[]>>;
  modelsError: Partial<Record<AiProvider, string>>;
}

export const useCopilot = create<CopilotModels>()(() => ({ models: {}, modelsError: {} }));

/** Load the models a key can use; also how a key is tested. Picks a default model if none. */
export async function loadModels(provider: AiProvider): Promise<void> {
  const key = useAiKeys.getState().keys[provider];
  if (!key) return;
  try {
    const models = await listModels(provider, key);
    useCopilot.setState((state) => ({
      models: { ...state.models, [provider]: models },
      modelsError: { ...state.modelsError, [provider]: undefined },
    }));
    const vault = useAiKeys.getState();
    const chosen = vault.models[provider];
    if (!chosen || !models.includes(chosen)) {
      const fallback = defaultModel(provider, models);
      if (fallback) vault.setModel(provider, fallback);
    }
  } catch (error) {
    useCopilot.setState((state) => ({
      modelsError: { ...state.modelsError, [provider]: failureOf(error).message },
    }));
  }
}

/** A new or removed key: the model list and any error belonged to the old one. */
export function forgetModels(provider: AiProvider): void {
  useCopilot.setState((state) => ({
    models: { ...state.models, [provider]: undefined },
    modelsError: { ...state.modelsError, [provider]: undefined },
  }));
}

/** Headlines for the question: about the first catalogue symbol it names, else the latest. */
async function headlinesFor(question: string): Promise<NewsItem[]> {
  const words = question.toUpperCase();
  const named = INSTRUMENTS.find((item) =>
    new RegExp(`\\b${item.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(words),
  );
  const query = named ? newsTarget(named.id).rss : '';
  try {
    const body = await edgeJson(`/news${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`);
    if (typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items)) {
      return body.items as NewsItem[];
    }
  } catch {
    // Headlines are context, not a requirement: answer from the panels alone.
  }
  return [];
}

/** The Macro panel's FRED series, through the same edge requests (so the edge cache answers). */
async function macroSeries(now: number): Promise<SeriesMap | null> {
  const today = new Date(now).toISOString().slice(0, 10);
  try {
    const [curve, stats] = await Promise.all([
      fetchFred(CURVE_IDS, daysBefore(today, CURVE_DAYS)),
      fetchFred(STAT_IDS, daysBefore(today, STAT_DAYS)),
    ]);
    return { ...curve, ...stats };
  } catch {
    return null;
  }
}

async function calendarReleases(): Promise<Release[] | null> {
  try {
    return parseCalendar(await edgeJson('/calendar'));
  } catch {
    return null;
  }
}

/** Ask the co-pilot. Explains from what is on screen; never recommends. */
export async function askCopilot(
  question: string,
  panels: readonly PanelRef[],
): Promise<CopilotResult> {
  const trimmed = question.trim();
  // Advice is refused here, without sending anything anywhere.
  if (asksForAdvice(trimmed)) return { status: 'refused', message: ADVICE_REFUSAL };
  const vault = useAiKeys.getState();
  const provider = vault.provider;
  const key = vault.keys[provider];
  const model = vault.models[provider];
  if (!key || !model)
    return { status: 'error', message: 'Add your AI key and pick a model first.' };
  const ticks = useTickStore.getState();
  const predictions = usePredictionStore.getState();
  const open = (component: string) => panels.some((panel) => panel.component === component);
  const now = Date.now();
  const [headlines, fred, releases] = await Promise.all([
    headlinesFor(trimmed),
    open('macro') ? macroSeries(now) : null,
    open('calendar') ? calendarReleases() : null,
  ]);
  const context = buildContext({
    panels,
    ticks,
    barsOf: (item) => cachedHistory(item, '1h', priceHistorySpan(item))?.bars,
    events: predictions.events,
    midpoints: predictions.midpoints,
    paper: open('paper') ? usePaperStore.getState() : null,
    headlines,
    fred,
    releases,
    options: useOptionsSummaries.getState(),
    now,
  });
  try {
    const text = await askProvider(
      provider,
      key,
      model,
      SYSTEM_PROMPT,
      contextMessage(context, trimmed, now, ticks.cursor),
    );
    if (givesAdvice(text)) return { status: 'withheld', message: ADVICE_WITHHELD };
    const byId = new Map(context.map((item) => [item.id, item]));
    const cited = citedIds(text).flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    return {
      status: 'answered',
      answer: { question: trimmed, text, cited, context, provider, model, at: now },
    };
  } catch (error) {
    return { status: 'error', message: failureOf(error).message };
  }
}
