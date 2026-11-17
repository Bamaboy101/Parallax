import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAlerts } from '../store/alerts/store';
import { usePrefs } from '../store/prefs';
import { CUE_GAP_MS, CUES, playCue, resetSound, schedule, useSoundLayer } from './sound';

/** A stand-in AudioContext that records the notes it was asked to play. */
class FakeAudio {
  static notes: number[] = [];
  currentTime = 10;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createOscillator() {
    const oscillator = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(() => {
        FakeAudio.notes.push(oscillator.frequency.value);
      }),
      stop: vi.fn(),
    };
    return oscillator;
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
}

beforeEach(() => {
  FakeAudio.notes = [];
  vi.stubGlobal('AudioContext', FakeAudio);
  resetSound();
});

afterEach(() => {
  vi.unstubAllGlobals();
  usePrefs.setState({ sound: false, soundVolume: 0.5 });
  useAlerts.setState({ alerts: [] });
});

describe('sound layer', () => {
  it('stays silent until switched on', () => {
    playCue('alert', undefined, 0);
    expect(FakeAudio.notes).toEqual([]);
    usePrefs.setState({ sound: true });
    playCue('alert', undefined, 0);
    expect(FakeAudio.notes).toEqual([660, 880]);
  });

  it('plays a burst as one cue and a whale print only once', () => {
    usePrefs.setState({ sound: true });
    playCue('whale', 'BTC-USD:1', 0);
    playCue('whale', 'BTC-USD:2', CUE_GAP_MS - 1);
    playCue('whale', 'BTC-USD:1', CUE_GAP_MS + 1);
    expect(FakeAudio.notes).toEqual([196]);
    playCue('whale', 'BTC-USD:3', CUE_GAP_MS + 2);
    expect(FakeAudio.notes).toEqual([196, 196]);
  });

  it('scales each note to the volume and never starts above silence', () => {
    const gains: number[] = [];
    const context = new FakeAudio();
    context.createGain = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn((value: number) => {
          gains.push(value);
        }),
      },
      connect: vi.fn(),
    });
    schedule(context as unknown as BaseAudioContext, CUES.whale, 0.5);
    expect(gains).toEqual([0.3, 0.0001]);
  });

  it('sounds when an alert fires, and not for alerts that had already fired', () => {
    usePrefs.setState({ sound: true });
    const rule = { kind: 'level', symbol: 'BTC-USD', direction: 'above', level: 1 } as const;
    useAlerts.setState({
      alerts: [{ id: 'old', rule, createdAt: 0, status: 'fired' }],
    });
    renderHook(() => {
      useSoundLayer();
    });
    expect(FakeAudio.notes).toEqual([]);
    useAlerts.setState({
      alerts: [
        { id: 'old', rule, createdAt: 0, status: 'fired' },
        { id: 'new', rule, createdAt: 0, status: 'fired' },
      ],
    });
    expect(FakeAudio.notes).toEqual([660, 880]);
  });
});
