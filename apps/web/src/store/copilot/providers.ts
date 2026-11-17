import { isObject } from '../../feeds/adapters/parse';
import { RequestError, retryAtFrom } from '../failure';
import type { AiProvider } from './keys';

/**
 * The co-pilot's two AI providers, called straight from the browser with the user's own key.
 * Each client builds every URL from its own origin and refuses any other, so a key can only ever
 * reach the provider it belongs to.
 */
export interface ProviderInfo {
  id: AiProvider;
  name: string;
  origin: string;
  /** Where the user creates a key. */
  keysUrl: string;
}

export const PROVIDERS: Readonly<Record<AiProvider, ProviderInfo>> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    origin: 'https://api.anthropic.com',
    keysUrl: 'https://platform.claude.com/settings/keys',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    origin: 'https://api.openai.com',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
};

/** Anthropic's latest API version (17 Nov 2026); it no longer accepts temperature or top_p. */
export const ANTHROPIC_VERSION = '2026-10-21';
const MAX_TOKENS = 900;

export class ProviderOriginError extends Error {
  override name = 'ProviderOriginError';
}

/** A provider URL; anything that would leave the provider's origin is refused. */
export function providerUrl(provider: AiProvider, path: string): URL {
  const { origin } = PROVIDERS[provider];
  if (!path.startsWith('/v1/')) throw new ProviderOriginError(`Not an API path: ${path}`);
  const url = new URL(path, origin);
  if (url.origin !== origin)
    throw new ProviderOriginError(`Requests for ${provider} go only to ${origin}`);
  return url;
}

function headers(provider: AiProvider, key: string, json: boolean): Record<string, string> {
  const content: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  return provider === 'anthropic'
    ? {
        ...content,
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        // Anthropic accepts browser (CORS) calls only with this header; the key is the user's own.
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : { ...content, Authorization: `Bearer ${key}` };
}

/** The provider's error message, or a plain one. Anthropic: { error: { message } }; OpenAI the same. */
function errorMessage(body: unknown, status: number, provider: AiProvider): string {
  const error = isObject(body) && isObject(body.error) ? body.error : null;
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (provider === 'anthropic' && message.startsWith('CORS requests are not allowed')) {
    return 'Your Anthropic organisation does not allow browser requests (zero data retention, the Compliance API or an Enterprise parent turns them off). Use a key from an organisation without those settings, or an OpenAI key.';
  }
  if (status === 401) return `${PROVIDERS[provider].name} did not accept this key.`;
  return message || `${PROVIDERS[provider].name} answered HTTP ${String(status)}`;
}

async function call(
  provider: AiProvider,
  key: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(providerUrl(provider, path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(provider, key, body !== undefined),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new RequestError(
      errorMessage(parsed, response.status, provider),
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  return parsed;
}

/** Text-chat models from a provider's list, newest first. */
export function chatModels(provider: AiProvider, body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body.data)) throw new Error('unexpected model list');
  const rows = body.data.flatMap((entry) => {
    if (!isObject(entry) || typeof entry.id !== 'string') return [];
    const created =
      typeof entry.created === 'number'
        ? entry.created * 1000
        : typeof entry.created_at === 'string'
          ? Date.parse(entry.created_at)
          : 0;
    return [{ id: entry.id, created: Number.isNaN(created) ? 0 : created }];
  });
  const usable =
    provider === 'anthropic'
      ? rows.filter((row) => row.id.startsWith('claude'))
      : rows.filter(
          (row) =>
            /^(gpt-|o\d|chatgpt-)/.test(row.id) &&
            !/(audio|realtime|transcribe|tts|image|embedding|search|instruct|moderation|codex|dall)/.test(
              row.id,
            ),
        );
  return usable.sort((a, b) => b.created - a.created).map((row) => row.id);
}

/** A sensible default from the list: a mid-size Claude (Sonnet), or OpenAI's newest general model. */
export function defaultModel(provider: AiProvider, models: readonly string[]): string | undefined {
  const preferred =
    provider === 'anthropic'
      ? models.find((id) => id.includes('sonnet'))
      : models.find((id) => /^gpt-\d/.test(id) && !id.includes('nano'));
  return preferred ?? models[0];
}

/** The models this key can use. Also the key test: a refused key fails here. */
export async function listModels(provider: AiProvider, key: string): Promise<string[]> {
  return chatModels(
    provider,
    await call(provider, key, provider === 'anthropic' ? '/v1/models?limit=100' : '/v1/models'),
  );
}

/** Anthropic: `content` is a list of blocks; the answer is its text blocks. */
export function anthropicText(body: unknown): string {
  if (!isObject(body) || !Array.isArray(body.content))
    throw new Error('unexpected Anthropic answer');
  return body.content
    .flatMap((block) =>
      isObject(block) && block.type === 'text' && typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('\n')
    .trim();
}

/** OpenAI Responses: `output` messages hold `output_text` parts. */
export function openaiText(body: unknown): string {
  if (!isObject(body)) throw new Error('unexpected OpenAI answer');
  if (typeof body.output_text === 'string' && body.output_text.trim() !== '')
    return body.output_text.trim();
  if (!Array.isArray(body.output)) throw new Error('unexpected OpenAI answer');
  return body.output
    .flatMap((item): unknown[] =>
      isObject(item) && item.type === 'message' && Array.isArray(item.content) ? item.content : [],
    )
    .flatMap((part) =>
      isObject(part) && part.type === 'output_text' && typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n')
    .trim();
}

/** Ask one question with the terminal's context; returns the answer text. */
export async function askProvider(
  provider: AiProvider,
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (provider === 'anthropic') {
    return anthropicText(
      await call(provider, key, '/v1/messages', {
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    );
  }
  return openaiText(
    await call(provider, key, '/v1/responses', {
      model,
      instructions: system,
      input: user,
      max_output_tokens: MAX_TOKENS,
      // Do not keep the conversation on OpenAI's side.
      store: false,
    }),
  );
}
