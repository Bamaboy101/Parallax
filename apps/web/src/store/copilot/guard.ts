/**
 * F1 hard rule: the co-pilot explains, it never recommends. Two checks in code, beside the
 * system prompt: requests for advice are answered locally without calling the AI, and an answer
 * that recommends a trade anyway is withheld.
 */

/** Asking what to do with money: buy, sell, hold, size, time or target. */
const ADVICE_REQUEST =
  /\b(should|shall|would|could) (i|we|you) (buy|sell|short|hold|invest|go long|go short|get in|get out|exit|close|open)\b|\bis (it|this|now) (a )?(good|right|smart|wise) (time|moment|idea|buy|investment|entry)\b|\bwhat (should|do|can) (i|we) (buy|sell|invest in|trade)\b|\b(worth|good) (buying|selling|investing)\b|\bprice target\b|\bhow much should i (buy|sell|invest|put)\b|\b(recommend|recommendation|tip)s? (a|any|some)?\s*(stock|coin|trade|buy)/i;

/** An answer that tells the reader what to trade, or when, or at what price. */
const ADVICE_ANSWER =
  /\b(you should|you might want to|i (would |'d )?(recommend|suggest|advise)|consider (buying|selling|shorting|adding|trimming)|(buy|sell|short) (now|it|this|the dip|the rally)|go (long|short)|good (time|moment|entry) to (buy|sell|enter)|strong (buy|sell)|price target|take profits?|set a stop|stop[- ]loss at|accumulate|load up)\b/i;

export const ADVICE_REFUSAL =
  'The co-pilot explains what is happening on the terminal; it does not tell anyone whether to buy, sell or hold. Ask what is moving and why, for example “Why is BTC down today?”, and decide for yourself.';

export const ADVICE_WITHHELD =
  'That answer drifted into recommending a trade, so it is not shown: the co-pilot explains, it does not recommend. Try asking what moved and why.';

export const asksForAdvice = (question: string): boolean => ADVICE_REQUEST.test(question);
export const givesAdvice = (answer: string): boolean => ADVICE_ANSWER.test(answer);

/** `[P1]`, `[N3]`, `[O2]` markers in an answer, in order of first use. */
export function citedIds(answer: string): string[] {
  const ids: string[] = [];
  for (const match of answer.matchAll(/\[([PNO]\d{1,2})\]/g)) {
    const id = match[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export const SYSTEM_PROMPT = [
  'You are the co-pilot of Open Terminal, a free market terminal. You explain markets in plain words to self-directed traders and learners.',
  'Answer only from the CONTEXT you are given: the panels on the user’s screen with their latest figures (ids P1, P2…), prediction-market odds (O1, O2…) and recent headlines (N1, N2…). If the context does not show something, say the terminal does not show it; never invent prices, events or causes.',
  'Cite every claim with the ids it rests on, in square brackets, for example “BTC is down 2.1% over 24 hours [P1], as headlines report a liquidation wave [N3].” Use only ids that appear in the context.',
  'Never give investment advice. Do not tell the user to buy, sell, hold, short, enter, exit, size or time anything; do not give price targets or forecasts. Explain what moved, what the figures mean and what news is associated with it; correlation in headlines is not proof of cause, so say “reported”, “coincides with”.',
  'Prediction-market odds are market odds, not forecasts. Paper-account figures are simulated, fake money.',
  'Be brief: at most about 150 words, short paragraphs or a few bullets, no tables.',
].join('\n\n');
