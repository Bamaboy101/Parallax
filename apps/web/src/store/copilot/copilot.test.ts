import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedEvent } from '../../feeds/types';
import { EDGE_URL } from '../edge';
import { ingest, resetTicks, useTickStore } from '../ticks';
import { buildContext } from './context';
import { ADVICE_REFUSAL, asksForAdvice, citedIds, givesAdvice } from './guard';
import { useAiKeys } from './keys';
import {
  anthropicText,
  ANTHROPIC_VERSION,
  askProvider,
  chatModels,
  defaultModel,
  openaiText,
  providerUrl,
} from './providers';
import { askCopilot } from './store';

describe('buildContext', () => {
  it('gives Macro, Calendar and Options the figures their panels show, and skips panels without any', () => {
    const items = buildContext({
      panels: [
        { component: 'macro', title: 'Macro', params: {} },
        { component: 'calendar', title: 'Calendar', params: {} },
        { component: 'session-ring', title: 'Sessions', params: {} },
        { component: 'options', title: 'Options · SPY', params: { symbol: 'SPY' } },
      ],
      ticks: useTickStore.getState(),
      barsOf: () => undefined,
      events: [],
      midpoints: {},
      paper: null,
      headlines: [],
      fred: {
        DGS2: [{ date: '2026-11-14', value: 3.6 }],
        DGS10: [{ date: '2026-11-14', value: 4.1 }],
        PAYEMS: [
          { date: '2026-09-01', value: 159_000 },
          { date: '2026-10-01', value: 159_120 },
        ],
      },
      releases: [{ date: '2026-11-20', id: 50, name: 'Employment Situation' }],
      options: {
        SPY: {
          expiry: '2026-11-18',
          spot: 730.76,
          atmIv: 0.359,
          putCall: { callVolume: 100, putVolume: 150, ratio: 1.5, day: '2026-11-17' },
          at: now,
        },
      },
      now,
    });
    expect(items.map((item) => `${item.id}:${item.label}`)).toEqual([
      'P1:Macro',
      'P2:Calendar',
      'P3:Options · SPY',
    ]);
    expect(items[0]?.detail).toContain('10Y − 2Y spread +0.50 pp');
    expect(items[0]?.detail).toContain('Payrolls, monthly change +120k jobs (as of 2026-10-01)');
    expect(items[1]?.detail).toContain('2026-11-20 Employment Situation');
    expect(items[2]?.detail).toContain('indicative feed');
    expect(items[2]?.detail).toContain(
      'at-the-money implied volatility 35.9%, put/call ratio 1.50',
    );
  });
});

const now = Date.now();
const trade = (symbol: string, price: number): FeedEvent => ({
  channel: 'trade',
  symbol,
  source: 'coinbase',
  ts: now - 1000,
  receivedAt: now - 1000,
  price,
  size: 1,
});

/** Shaped like Anthropic's documented Messages response. */
const anthropicAnswer = (text: string) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const requestOf = (call: unknown[]) => {
  const [url, init] = call as [URL | string, RequestInit | undefined];
  const body = typeof init?.body === 'string' ? init.body : 'null';
  return { url: String(url), init: init ?? {}, body };
};

describe('provider clients', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build URLs only on their own provider', () => {
    expect(providerUrl('anthropic', '/v1/messages').origin).toBe('https://api.anthropic.com');
    expect(providerUrl('openai', '/v1/responses').origin).toBe('https://api.openai.com');
    expect(() => providerUrl('openai', 'https://evil.example/v1/responses')).toThrow();
    expect(() => providerUrl('anthropic', '//evil.example/v1/messages')).toThrow();
  });

  it('send the Anthropic key only to Anthropic, with the browser header and no temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(anthropicAnswer('BTC fell [P1].')));
    vi.stubGlobal('fetch', fetchMock);
    const text = await askProvider('anthropic', 'sk-ant-test', 'claude-test', 'system', 'question');
    expect(text).toBe('BTC fell [P1].');
    const { url, init } = requestOf(fetchMock.mock.calls[0] ?? []);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    const body = JSON.parse(requestOf(fetchMock.mock.calls[0] ?? []).body) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ model: 'claude-test', system: 'system' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('send the OpenAI key only to OpenAI and ask it not to store the conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        object: 'response',
        output: [
          { type: 'reasoning', id: 'rs_1', summary: [] },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Rates rose [P2].', annotations: [] }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await askProvider('openai', 'sk-test', 'gpt-test', 'system', 'question')).toBe(
      'Rates rose [P2].',
    );
    const { url, init } = requestOf(fetchMock.mock.calls[0] ?? []);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(requestOf(fetchMock.mock.calls[0] ?? []).body)).toMatchObject({
      instructions: 'system',
      input: 'question',
      store: false,
    });
  });

  it('explain an organisation that blocks browser requests instead of calling the key bad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'CORS requests are not allowed for this Organization',
            },
          },
          401,
        ),
      ),
    );
    await expect(askProvider('anthropic', 'k', 'm', 's', 'q')).rejects.toThrow(
      /does not allow browser requests/,
    );
  });

  it('read answers and model lists in the documented shapes', () => {
    expect(anthropicText(anthropicAnswer('a'))).toBe('a');
    expect(openaiText({ output_text: ' b ' })).toBe('b');
    expect(() => anthropicText({ error: {} })).toThrow();
    const openai = chatModels('openai', {
      object: 'list',
      data: [
        { id: 'gpt-old', created: 1, object: 'model' },
        { id: 'text-embedding-3-small', created: 9, object: 'model' },
        { id: 'gpt-new', created: 5, object: 'model' },
        { id: 'gpt-new-realtime', created: 6, object: 'model' },
      ],
    });
    expect(openai).toEqual(['gpt-new', 'gpt-old']);
    const anthropic = chatModels('anthropic', {
      data: [
        { type: 'model', id: 'claude-haiku-x', created_at: '2026-01-01T00:00:00Z' },
        { type: 'model', id: 'claude-sonnet-x', created_at: '2025-06-01T00:00:00Z' },
      ],
    });
    expect(defaultModel('anthropic', anthropic)).toBe('claude-sonnet-x');
  });
});

describe('advice guard', () => {
  it.each([
    'Should I buy BTC now?',
    'is now a good time to sell Tesla',
    'what should I invest in',
    'give me a price target for NVDA',
    'Is it worth buying gold?',
  ])('refuses "%s"', (question) => {
    expect(asksForAdvice(question)).toBe(true);
  });

  it.each([
    'Why is BTC down today?',
    'Brief me on today',
    'What does funding mean?',
    'Explain the event odds',
  ])('answers "%s"', (question) => {
    expect(asksForAdvice(question)).toBe(false);
  });

  it('catches answers that recommend and lets explanations through', () => {
    expect(givesAdvice('BTC is down 2% [P1]. You should buy the dip.')).toBe(true);
    expect(givesAdvice('I would recommend trimming your position.')).toBe(true);
    expect(givesAdvice('BTC is down 2% [P1], as headlines report outflows [N2].')).toBe(false);
  });

  it('reads citation ids in order of first use, once each', () => {
    expect(citedIds('a [N2] b [P1] c [N2] [X9] [O1]')).toEqual(['N2', 'P1', 'O1']);
  });
});

describe('askCopilot', () => {
  beforeEach(() => {
    useAiKeys.setState({
      keys: { anthropic: 'sk-ant-secret' },
      provider: 'anthropic',
      models: { anthropic: 'claude-test' },
    });
    ingest([trade('BTC-USD', 64_000)]);
  });

  afterEach(() => {
    resetTicks();
    vi.unstubAllGlobals();
    useAiKeys.setState({ keys: {}, provider: 'anthropic', models: {} });
  });

  const panels = [{ component: 'watchlist', title: 'Watchlist', params: { symbols: ['BTC-USD'] } }];

  it('answers from the screen and headlines and resolves what it cites', async () => {
    const fetchMock = vi.fn((url: URL | string) => {
      if (String(url).startsWith(EDGE_URL)) {
        return Promise.resolve(
          json({
            items: [
              {
                title: 'Bitcoin slips as ETF outflows grow',
                url: 'https://news.example/btc',
                source: 'Example Wire',
                published: now - 60_000,
                summary: '',
              },
            ],
            sources: [],
          }),
        );
      }
      return Promise.resolve(
        json(anthropicAnswer('BTC trades at 64,000 [P1] as outflows are reported [N1].')),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askCopilot('Why is BTC down?', panels);

    expect(result.status).toBe('answered');
    if (result.status !== 'answered') return;
    expect(result.answer.cited.map((item) => `${item.kind}:${item.label}`)).toEqual([
      'panel:Watchlist',
      'headline:Bitcoin slips as ETF outflows grow',
    ]);
    const calls = fetchMock.mock.calls.map((call) => requestOf(call));
    // The headlines request names the asset, never the key; the key goes only to Anthropic.
    expect(calls[0]?.url).toContain('/news?q=');
    for (const call of calls) {
      const sentKey = JSON.stringify(call.init.headers ?? {}).includes('sk-ant-secret');
      expect(sentKey).toBe(call.url.startsWith('https://api.anthropic.com/'));
    }
    const sent = JSON.parse(calls[1]?.body ?? 'null') as { messages: { content: string }[] };
    expect(sent.messages[0]?.content).toMatch(/\[P1\] Panel “Watchlist”: BTC\/USD 64,000/);
  });

  it('refuses advice without sending anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await askCopilot('Should I buy BTC?', panels)).toEqual({
      status: 'refused',
      message: ADVICE_REFUSAL,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('withholds an answer that recommends a trade', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: URL | string) =>
        Promise.resolve(
          String(url).startsWith(EDGE_URL)
            ? json({ items: [], sources: [] })
            : json(anthropicAnswer('BTC is down [P1]; consider buying here.')),
        ),
      ),
    );
    expect((await askCopilot('Why is BTC down?', panels)).status).toBe('withheld');
  });
});
