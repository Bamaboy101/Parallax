import { useId, useState } from 'react';
import { playCue, unlockSound } from '../../app/sound';
import { recognitionClass } from '../../command/speech';
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
      {status?.symbolLimit != null && status.serving.length > 0 && (
        <p className="settings-state">
          Streaming {status.serving.length} of {status.symbolLimit} symbols allowed on the free plan
        </p>
      )}
      {status !== undefined && status.waiting.length > 0 && (
        <p className="settings-check settings-check--bad">
          Over the free limit, not streaming: {status.waiting.join(', ')}
        </p>
      )}
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

const VOICE = [
  ['local', 'On this device only'],
  ['online', 'Also the browser’s online speech service'],
] as const;

const SOUND = [
  ['off', 'Off'],
  ['on', 'On'],
] as const;

/** The sound layer (F12): off by default; on, three short cues and a volume. */
function SoundSettings() {
  const { sound, soundVolume, setSound, setSoundVolume } = usePrefs();
  const volumeId = useId();
  return (
    <>
      <h2 className="settings-heading">Sound</h2>
      <p className="settings-note">
        Short tones for an alert that fires, a whale print on an open tape, and the network going
        away. Prices never make a sound by themselves.
      </p>
      <Choice
        legend="Sound cues"
        value={sound ? 'on' : 'off'}
        options={SOUND}
        onChange={(value) => {
          // The switch is a click, so the browser lets audio start from here on.
          if (value === 'on') unlockSound();
          setSound(value === 'on');
        }}
      />
      {sound && (
        <div className="settings-sound">
          <label htmlFor={volumeId}>Volume</label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={soundVolume}
            onChange={(event) => {
              setSoundVolume(Number(event.target.value));
            }}
          />
          {(['alert', 'whale', 'offline'] as const).map((cue) => (
            <button
              key={cue}
              type="button"
              className="chart-interval"
              onClick={() => {
                playCue(cue);
              }}
            >
              Play {cue}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Key vault with a per-provider key test and signup links, plus display, voice and sound. */
export default function Settings() {
  const { palette, density, voiceOnline, setPalette, setDensity, setVoiceOnline } = usePrefs();
  const voice = recognitionClass() !== undefined;
  return (
    <div className="settings-panel">
      <h2 className="settings-heading">Data keys</h2>
      <p className="settings-note">
        Crypto and FX work without a key. A free key from a provider below switches on live US
        stocks. Keys stay in this browser and are sent only to their own provider, never to
        Parallax.
      </p>
      {KEY_PROVIDERS.map((provider) => (
        <ProviderKeys key={provider.id} provider={provider} />
      ))}
      <h2 className="settings-heading">Display</h2>
      <Choice legend="Price colours" value={palette} options={PALETTES} onChange={setPalette} />
      <Choice legend="Density" value={density} options={DENSITIES} onChange={setDensity} />
      <h2 className="settings-heading">Voice commands</h2>
      {voice ? (
        <>
          <p className="settings-note">
            The microphone in the command bar turns what you say into a command. On-device
            recognition keeps the audio on this computer. The online service is your browser
            maker&apos;s: it hears what you say, so it is used only if you allow it here or when
            first asked. Parallax never receives the audio.
          </p>
          <Choice
            legend="Recognise speech"
            value={voiceOnline ? 'online' : 'local'}
            options={VOICE}
            onChange={(value) => {
              setVoiceOnline(value === 'online');
            }}
          />
        </>
      ) : (
        <p className="settings-note">This browser has no speech recognition, so voice is off.</p>
      )}
      <SoundSettings />
    </div>
  );
}
