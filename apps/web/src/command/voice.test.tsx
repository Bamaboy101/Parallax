import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIDGETS } from '../app/widgets';
import { usePrefs } from '../store/prefs';
import { CommandPalette } from './CommandPalette';
import { suggest, type Command } from './parser';
import type { Recognition, RecognitionConstructor } from './speech';
import { openCommandBar } from './state';
import { normalizeSpoken } from './voice';

const widgets = WIDGETS.map((widget) => widget.meta);

describe('normalizeSpoken', () => {
  it('turns what speech engines write into command-bar words', () => {
    expect(normalizeSpoken('Bitcoin chart one hour.')).toBe('btc chart 1h');
    expect(normalizeSpoken('Show me the Ether chart, 15 minutes')).toBe('eth chart 15m');
    expect(normalizeSpoken('Alert Bitcoin above $65,000')).toBe('alert btc above 65000');
    expect(normalizeSpoken('Tell me when Solana drops 2 percent in an hour')).toBe(
      'alert sol drops 2% in 1h',
    );
    expect(normalizeSpoken('Open the crypto layout')).toBe('layout crypto');
    expect(normalizeSpoken('watch Apple please')).toBe('watch aapl');
    expect(normalizeSpoken('news for Tesla')).toBe('news tesla');
  });

  it('gives words the bar can run', () => {
    const first = (spoken: string) => suggest(normalizeSpoken(spoken), widgets, ['Crypto'])[0];
    expect(first('Bitcoin chart one hour')?.title).toBe('Chart BTC/USD 1h');
    expect(first('Open the crypto layout')?.command).toEqual({ kind: 'layout', name: 'Crypto' });
    expect(first('Alert Bitcoin above $65,000')?.command).toMatchObject({
      kind: 'open',
      query: 'btc above 65000',
    });
  });
});

/** A stand-in for the browser's recognizer: the test says what was heard. */
function fakeRecognizer(availability: 'available' | 'downloadable' | 'unavailable' | null) {
  const made: (Recognition & { say: (text: string, final: boolean) => void })[] = [];
  class Fake {
    lang = '';
    continuous = true;
    interimResults = false;
    maxAlternatives = 0;
    processLocally?: boolean;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    started = false;
    constructor() {
      made.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
    say(text: string, final: boolean) {
      const result = Object.assign([{ transcript: text }], { isFinal: final });
      this.onresult?.({ resultIndex: 0, results: Object.assign([result], {}) });
      if (final) this.onend?.();
    }
  }
  const Recognizer = Fake as unknown as RecognitionConstructor;
  if (availability !== null) {
    Recognizer.available = vi.fn(() => Promise.resolve(availability));
    Recognizer.install = vi.fn(() => Promise.resolve(true));
  }
  return { Recognizer, made };
}

const flush = () => act(() => Promise.resolve());

afterEach(() => {
  vi.unstubAllGlobals();
  usePrefs.setState({ voiceOnline: false });
});

describe('voice in the command bar', () => {
  it('listens on the device when it can, and runs the best match for what was heard', async () => {
    const { Recognizer, made } = fakeRecognizer('available');
    vi.stubGlobal('SpeechRecognition', Recognizer);
    const run = vi.fn<(command: Command) => boolean>(() => true);
    render(<CommandPalette run={run} widgets={widgets} layouts={['Crypto']} />);
    act(() => {
      openCommandBar();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
    await flush();
    const recognition = made[0];
    expect(recognition?.processLocally).toBe(true);
    expect(recognition?.lang).toBe('en-US');
    expect(screen.getByText(/Listening on this device/)).toBeInTheDocument();
    act(() => {
      recognition?.say('Bitcoin chart', false);
    });
    expect(screen.getByText(/“Bitcoin chart”/)).toBeInTheDocument();
    act(() => {
      recognition?.say('Bitcoin chart one hour', true);
    });
    const command = run.mock.calls[0]?.[0];
    expect(command?.kind === 'open' && [command.symbol?.id, command.interval]).toEqual([
      'BTC-USD',
      '1h',
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before using the online service, and never starts the microphone without consent', async () => {
    const { Recognizer, made } = fakeRecognizer(null);
    vi.stubGlobal('webkitSpeechRecognition', Recognizer);
    const run = vi.fn<(command: Command) => boolean>(() => true);
    render(<CommandPalette run={run} widgets={widgets} layouts={[]} />);
    act(() => {
      openCommandBar();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
    await flush();
    expect(made).toHaveLength(0);
    expect(
      screen.getByText(
        /sends what you say to its maker’s online speech service|sends what you say to its maker's online speech service/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the online service' }));
    expect(usePrefs.getState().voiceOnline).toBe(true);
    expect(made[0]?.processLocally).toBeUndefined();
  });

  it('says what it heard when nothing matches, and runs nothing', async () => {
    const { Recognizer, made } = fakeRecognizer('available');
    vi.stubGlobal('SpeechRecognition', Recognizer);
    const run = vi.fn<(command: Command) => boolean>(() => true);
    render(<CommandPalette run={run} widgets={widgets} layouts={[]} />);
    act(() => {
      openCommandBar();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
    await flush();
    act(() => {
      made[0]?.say('make me a sandwich', true);
    });
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(/Heard “make me a sandwich”/)).toBeInTheDocument();
  });

  it('shows no microphone where the browser has no speech recognition', () => {
    render(<CommandPalette run={vi.fn(() => true)} widgets={widgets} layouts={[]} />);
    act(() => {
      openCommandBar();
    });
    expect(screen.queryByRole('button', { name: 'Speak a command' })).not.toBeInTheDocument();
  });
});
