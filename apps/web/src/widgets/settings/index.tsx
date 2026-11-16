import { useId, useState } from 'react';
import '../../design/settings.css';
import type { SourceStatus, VerifyOutcome } from '../../feeds/protocol';
import { verifyKey } from '../../store/feedClient';
import { useSourceStatus } from '../../store/hooks';
import { useKeyVault } from '../../store/keys';
import { usePrefs, type Density, type Palette } from '../../store/prefs';
import { KEY_PROVIDERS, type KeyProvider } from './meta';

type Check = { state: 'idle' } | { state: 'testing' } | ({ state: 'done' } & VerifyOutcome);

/** What the stored key is doing right now, from the feed hub's status for that provider. */
function feedState(stored: boolean, status: SourceStatus | undefined): string {
  if (!stored) return 'No key saved';
  switch (status?.state) {
    case undefined:
    case 'idle':
    case 'no-key':
      return 'Saved · connects when a widget needs it';
    case 'connecting':
    case 'reconnecting':
      return 'Saved · connecting';
    case 'live':
      return status.stale ? 'Saved · connected, quiet' : 'Saved · live';
    case 'auth-failed':
      return 'Saved · rejected by the provider';
    case 'down':
      return 'Saved · provider unreachable, retrying';
  }
}

function checkMessage(check: Check, name: string): string {
  if (check.state === 'testing') return `Asking ${name}…`;
  if (check.state !== 'done') return '';
  if (check.result === 'accepted') return `${name} accepted this key.`;
  if (check.result === 'rejected') return `${name} rejected this key: ${check.message}`;
  return `Could not check the key: ${check.message}`;
}

function ProviderKeys({ provider }: { provider: KeyProvider }) {
  const stored = useKeyVault((state) => state.keys[provider.id]);
  const setKey = useKeyVault((state) => state.setKey);
  const status = useSourceStatus(provider.id);
  const [parts, setParts] = useState<string[]>(() =>
    provider.fields.map((_, index) => stored?.split(':')[index] ?? ''),
  );
  const [reveal, setReveal] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const id = useId();

  const key = parts.map((part) => part.trim()).join(':');
  const complete = parts.every((part) => part.trim() !== '');
  const changed = key !== (stored ?? provider.fields.map(() => '').join(':'));

  const edit = (index: number, value: string) => {
    setParts((current) => current.map((part, i) => (i === index ? value : part)));
    setCheck({ state: 'idle' });
  };

  const test = () => {
    setCheck({ state: 'testing' });
    void verifyKey(provider.id, key).then((outcome) => {
      setCheck({ state: 'done', ...outcome });
    });
  };

  const tone =
    check.state === 'done'
      ? check.result === 'accepted'
        ? 'settings-check--ok'
        : 'settings-check--bad'
      : '';

  return (
    <section className="settings-card" aria-labelledby={`${id}-name`}>
      <header className="settings-card-head">
        <h3 id={`${id}-name`}>{provider.name}</h3>
        <a href={provider.signupUrl} target="_blank" rel="noreferrer noopener">
          Get a free key
        </a>
      </header>
      <p className="settings-note">{provider.unlocks}</p>
      <p className="settings-note settings-muted">{provider.limits}</p>
      <form
        className="settings-fields"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) setKey(provider.id, key);
        }}
      >
        {provider.fields.map((label, index) => (
          <label key={label} className="settings-field">
            <span>{label}</span>
            <input
              type={reveal ? 'text' : 'password'}
              value={parts[index] ?? ''}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                edit(index, event.target.value);
              }}
            />
          </label>
        ))}
        <div className="settings-actions">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={reveal}
              onChange={(event) => {
                setReveal(event.target.checked);
              }}
            />
            Show
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={!complete || check.state === 'testing'}
            onClick={test}
          >
            Test my key
          </button>
          <button
            type="submit"
            className="settings-button settings-button--primary"
            disabled={!complete || !changed}
          >
            Save
          </button>
          {stored !== undefined && (
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setKey(provider.id, '');
                setParts(provider.fields.map(() => ''));
                setCheck({ state: 'idle' });
              }}
            >
              Remove
            </button>
          )}
        </div>
      </form>
      <p className={`settings-check ${tone}`} role="status" aria-live="polite">
        {checkMessage(check, provider.name)}
      </p>
      <p className="settings-state">{feedState(stored !== undefined, status)}</p>
    </section>
  );
}

function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="settings-choice">
      <legend>{legend}</legend>
      {options.map(([option, label]) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => {
              onChange(option);
            }}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

const PALETTES = [
  ['green-red', 'Green up, red down'],
  ['blue-orange', 'Blue up, orange down'],
] as const satisfies readonly (readonly [Palette, string])[];

const DENSITIES = [
  ['comfortable', 'Comfortable'],
  ['dense', 'Dense'],
] as const satisfies readonly (readonly [Density, string])[];

/** Key vault with a per-provider key test and signup links, plus display preferences. */
export default function Settings() {
  const { palette, density, setPalette, setDensity } = usePrefs();
  return (
    <div className="settings-panel">
      <h2 className="settings-heading">Data keys</h2>
      <p className="settings-note">
        Crypto and FX work without a key. A free key from a provider below switches on live US
        stocks. Keys stay in this browser and are sent only to their own provider, never to Open
        Terminal.
      </p>
      {KEY_PROVIDERS.map((provider) => (
        <ProviderKeys key={provider.id} provider={provider} />
      ))}
      <h2 className="settings-heading">Display</h2>
      <Choice legend="Price colours" value={palette} options={PALETTES} onChange={setPalette} />
      <Choice legend="Density" value={density} options={DENSITIES} onChange={setDensity} />
    </div>
  );
}
