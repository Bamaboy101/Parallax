import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import '../../design/copilot.css';
import '../../design/market.css';
import { formatAge } from '../../design/format';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import type { ContextItem, PanelRef } from '../../store/copilot/context';
import { useAiKeys, type AiProvider } from '../../store/copilot/keys';
import { PROVIDERS } from '../../store/copilot/providers';
import {
  askCopilot,
  forgetModels,
  loadModels,
  useCopilot,
  type CopilotResult,
} from '../../store/copilot/store';
import { INSTRUMENTS } from '../../store/symbols';
import { GROUPS } from '../markets/meta';
import { ASIA_PACIFIC, EUROPE, type RegionBoard } from '../regionBoards';
import { useNow } from '../useNow';

interface CopilotParams {
  query?: string;
}

const STARTERS = [
  'Brief me on today',
  'What is moving the most, and why?',
  'Explain the event odds on screen',
];

const regionSymbols = (board: RegionBoard) => [
  ...board.fx,
  ...board.groups.flatMap((group) => group.rows.flatMap((row) => (row.proxy ? [row.proxy] : []))),
];

/** Fixed rows of the boards, so the co-pilot sees what they show. */
const BOARD_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  markets: GROUPS.flatMap((group) => group.rows.map((row) => row.id)),
  europe: regionSymbols(EUROPE),
  'asia-pacific': regionSymbols(ASIA_PACIFIC),
  fx: INSTRUMENTS.filter((item) => item.kind === 'fx').map((item) => item.id),
};

/** Every other panel in the dock, as the co-pilot sees it. */
function panelsOf(dock: DockviewApi): PanelRef[] {
  return dock.panels
    .filter((panel) => panel.api.component !== 'copilot')
    .map((panel) => {
      const symbols = BOARD_SYMBOLS[panel.api.component];
      return {
        component: panel.api.component,
        title: panel.title ?? panel.api.component,
        params: panel.params ?? {},
        ...(symbols ? { symbols } : {}),
      };
    });
}

/** Answer text with its [P1] markers drawn as small citation chips. */
function AnswerText({ text, cited }: { text: string; cited: readonly ContextItem[] }) {
  const known = new Set(cited.map((item) => item.id));
  return (
    <div className="copilot-answer-text">
      {text.split(/(\[[PNO]\d{1,2}\])/).map((part, index) => {
        const id = /^\[([PNO]\d{1,2})\]$/.exec(part)?.[1];
        if (!id) return <span key={index}>{part}</span>;
        return known.has(id) ? (
          <a key={index} className="copilot-cite" href={`#copilot-source-${id}`}>
            {id}
          </a>
        ) : (
          <span
            key={index}
            className="copilot-cite is-unknown"
            title="Not something the co-pilot was given"
          >
            {id}?
          </span>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<ContextItem['kind'], string> = {
  panel: 'Panel',
  odds: 'Event odds',
  headline: 'Headline',
};

function Source({ item, anchor }: { item: ContextItem; anchor: boolean }) {
  return (
    <li id={anchor ? `copilot-source-${item.id}` : undefined} className="copilot-source">
      <span className="copilot-cite">{item.id}</span>
      <span className="copilot-source-kind">{KIND_LABEL[item.kind]}</span>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer noopener">
          {item.label}
        </a>
      ) : (
        <span>{item.label}</span>
      )}
    </li>
  );
}

function KeySetup({ provider, onDone }: { provider: AiProvider; onDone: () => void }) {
  const vault = useAiKeys();
  const modelsError = useCopilot((state) => state.modelsError[provider]);
  const [draft, setDraft] = useState('');
  const info = PROVIDERS[provider];
  const saved = vault.keys[provider] !== undefined;
  // The panel checks the new key by loading its models; a refusal reopens this form.
  const save = (event: SyntheticEvent) => {
    event.preventDefault();
    vault.setKey(provider, draft);
    forgetModels(provider);
    setDraft('');
    onDone();
  };
  return (
    <form className="copilot-keys" onSubmit={save}>
      <fieldset className="copilot-providers">
        <legend>AI provider</legend>
        {(Object.keys(PROVIDERS) as AiProvider[]).map((id) => (
          <label key={id}>
            <input
              type="radio"
              name="copilot-provider"
              checked={provider === id}
              onChange={() => {
                vault.setProvider(id);
              }}
            />{' '}
            {PROVIDERS[id].name}
            {vault.keys[id] ? ' · key saved' : ''}
          </label>
        ))}
      </fieldset>
      <label className="copilot-key-field">
        <span>{info.name} API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={saved ? 'Saved. Paste a new key to replace it' : 'Paste your key'}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </label>
      <div className="copilot-key-actions">
        <button type="submit" className="chart-interval" disabled={draft.trim() === ''}>
          Save and check
        </button>
        {saved && (
          <button
            type="button"
            className="chart-interval"
            onClick={() => {
              vault.setKey(provider, '');
              forgetModels(provider);
            }}
          >
            Remove key
          </button>
        )}
        <a href={info.keysUrl} target="_blank" rel="noreferrer noopener">
          Get a key from {info.name}
        </a>
      </div>
      {modelsError && <p className="copilot-error">{modelsError}</p>}
      <p className="panel-footnote">
        Your key stays in this browser and goes only to {info.name}, never to Parallax or a data
        provider. Each question sends the figures on your screen and recent headlines to {info.name}{' '}
        under your key, and {info.name} bills your account.
      </p>
    </form>
  );
}

/**
 * The co-pilot (F1): plain-word questions answered from the panels on screen and recent
 * headlines, with the panels and headlines it used cited. It explains; it never recommends.
 */
export default function Copilot({ params, containerApi }: IDockviewPanelProps<CopilotParams>) {
  const vault = useAiKeys();
  const models = useCopilot((state) => state.models[vault.provider]);
  const keyProblem = useCopilot((state) => state.modelsError[vault.provider]);
  const provider = vault.provider;
  const key = vault.keys[provider];
  const model = vault.models[provider];
  const [editingKey, setEditingKey] = useState(false);
  const [question, setQuestion] = useState(params.query ?? '');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const now = useNow(30_000);
  const autoAsked = useRef(false);
  const ready = key !== undefined && model !== undefined && keyProblem === undefined;
  const showKeys = !key || editingKey || keyProblem !== undefined;

  useEffect(() => {
    if (key && !models && keyProblem === undefined) void loadModels(provider);
  }, [key, models, keyProblem, provider]);

  const ask = (text: string) => {
    if (text.trim() === '' || asking) return;
    setQuestion(text);
    setAsking(true);
    void askCopilot(text, panelsOf(containerApi)).then((next) => {
      setResult(next);
      setAsking(false);
    });
  };

  // A question typed in the command bar ("ask why is BTC down") is asked once, when ready.
  useEffect(() => {
    if (autoAsked.current || !ready || !params.query) return;
    autoAsked.current = true;
    ask(params.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.query]);

  const answer = result?.status === 'answered' ? result.answer : null;
  return (
    <div className="copilot-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">Co-pilot</span>
        <span className="panel-caption">Explains, never recommends</span>
        {!showKeys && (
          <button
            type="button"
            className="chart-interval copilot-key-toggle"
            onClick={() => {
              setEditingKey(true);
            }}
            title={`${PROVIDERS[provider].name} key and provider`}
          >
            Key
          </button>
        )}
      </div>
      {showKeys && (
        <KeySetup
          provider={provider}
          onDone={() => {
            setEditingKey(false);
          }}
        />
      )}
      {!showKeys && (
        <>
          <label className="copilot-model">
            <span>Model</span>
            <select
              value={model ?? ''}
              disabled={!models || models.length === 0}
              onChange={(event) => {
                vault.setModel(provider, event.target.value);
              }}
            >
              {!models && <option value={model ?? ''}>{model ?? 'Loading models…'}</option>}
              {models?.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <form
            className="copilot-ask"
            onSubmit={(event) => {
              event.preventDefault();
              ask(question);
            }}
          >
            <input
              type="text"
              aria-label="Question for the co-pilot"
              placeholder="Why is BTC down today?"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
              }}
            />
            <button
              type="submit"
              className="chart-interval"
              disabled={!ready || asking || question.trim() === ''}
            >
              {asking ? 'Asking…' : 'Ask'}
            </button>
          </form>
          <div className="copilot-starters">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                className="chart-interval"
                disabled={!ready || asking}
                onClick={() => {
                  ask(starter);
                }}
              >
                {starter}
              </button>
            ))}
          </div>
        </>
      )}
      {result && result.status !== 'answered' && (
        <PanelNotice
          notice={{
            tone: result.status === 'error' ? 'warn' : 'info',
            title:
              result.status === 'refused'
                ? 'The co-pilot does not give buy or sell advice'
                : result.status === 'withheld'
                  ? 'Answer withheld'
                  : 'The co-pilot could not answer',
            detail: result.message,
          }}
        />
      )}
      {answer && (
        <article className="copilot-answer" aria-live="polite">
          <h3 className="copilot-question">{answer.question}</h3>
          <AnswerText text={answer.text} cited={answer.cited} />
          <section aria-label="Sources">
            <h4 className="markets-group">Sources</h4>
            {answer.cited.length === 0 ? (
              <p className="copilot-error">
                This answer cites nothing on screen, so it cannot be checked against the terminal.
                Treat it with care.
              </p>
            ) : (
              <ul>
                {answer.cited.map((item) => (
                  <Source key={item.id} item={item} anchor />
                ))}
              </ul>
            )}
          </section>
          <p className="copilot-stamp">
            {PROVIDERS[answer.provider].name} · {answer.model} · from what was on screen{' '}
            {now - answer.at < 60_000 ? 'just now' : `${formatAge(now - answer.at)} ago`}
          </p>
          <details className="copilot-saw">
            <summary>What it saw ({String(answer.context.length)} items)</summary>
            <ul>
              {answer.context.map((item) => (
                <Source key={item.id} item={item} anchor={false} />
              ))}
            </ul>
          </details>
        </article>
      )}
      <p className="panel-footnote">
        Not investment advice. The co-pilot explains what the terminal shows and which panels and
        headlines it used; it does not tell you to buy, sell or hold. AI can be wrong: check its
        sources.
      </p>
    </div>
  );
}
