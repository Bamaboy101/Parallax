import { useEffect } from 'react';
import { useAlerts } from '../store/alerts/store';
import { usePrefs } from '../store/prefs';

/**
 * F12 sound layer, off by default: three short cues synthesised with the Web Audio API (no
 * audio files, nothing fetched). A cue marks an event the user asked to hear about; prices never
 * make a sound by themselves.
 *
 * - `alert`: an alert fired (two rising notes);
 * - `whale`: a whale print on a symbol whose tape is open (one low, soft note);
 * - `offline`: the network went away (two falling notes).
 */
export type Cue = 'alert' | 'whale' | 'offline';

/** One note: frequency in Hz, start and length in seconds, peak gain 0..1 before volume. */
export interface Note {
  hz: number;
  at: number;
  length: number;
  peak: number;
}

export const CUES: Readonly<Record<Cue, readonly Note[]>> = {
  alert: [
    { hz: 660, at: 0, length: 0.12, peak: 0.5 },
    { hz: 880, at: 0.13, length: 0.16, peak: 0.5 },
  ],
  whale: [{ hz: 196, at: 0, length: 0.22, peak: 0.6 }],
  offline: [
    { hz: 440, at: 0, length: 0.14, peak: 0.4 },
    { hz: 330, at: 0.15, length: 0.2, peak: 0.4 },
  ],
};

/** A cue of the same kind within this long of the last is dropped: a burst is one sound. */
export const CUE_GAP_MS = 1500;

const lastPlayed = new Map<Cue, number>();
const heard = new Set<string>();

/** Whether a cue may sound now (and remember that it did). */
export function claimCue(cue: Cue, now: number): boolean {
  const last = lastPlayed.get(cue);
  if (last !== undefined && now - last < CUE_GAP_MS) return false;
  lastPlayed.set(cue, now);
  return true;
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/**
 * Browsers start audio only after a user gesture: Settings calls this from its switch, so the
 * first cue is not lost.
 */
export function unlockSound(): void {
  void audio()?.resume();
}

/** Schedule a cue's notes: a sine with a 10 ms attack and an exponential release. */
export function schedule(target: BaseAudioContext, notes: readonly Note[], volume: number): void {
  const start = target.currentTime;
  for (const note of notes) {
    const oscillator = target.createOscillator();
    const gain = target.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = note.hz;
    const begin = start + note.at;
    const end = begin + note.length;
    gain.gain.setValueAtTime(0.0001, begin);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.peak * volume), begin + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(target.destination);
    oscillator.start(begin);
    oscillator.stop(end + 0.02);
  }
}

/** Play a cue if sound is on. `key` makes a cue once-only (a whale print seen by two tapes). */
export function playCue(cue: Cue, key?: string, now = Date.now()): void {
  const { sound, soundVolume } = usePrefs.getState();
  if (!sound) return;
  if (key !== undefined) {
    if (heard.has(key)) return;
    heard.add(key);
    if (heard.size > 500) heard.clear();
  }
  if (!claimCue(cue, now)) return;
  const target = audio();
  if (!target) return;
  schedule(target, CUES[cue], soundVolume);
}

/** Tests: forget what played. */
export function resetSound(): void {
  lastPlayed.clear();
  heard.clear();
}

/**
 * Mounted once in the shell: an alert that fires, and the network going away, each sound a cue.
 * Whale prints sound from the tapes that show them (`playCue('whale', key)`).
 */
export function useSoundLayer(): void {
  useEffect(() => {
    const fired = (alerts: ReturnType<typeof useAlerts.getState>['alerts']) =>
      new Set(alerts.filter((alert) => alert.status === 'fired').map((alert) => alert.id));
    let before = fired(useAlerts.getState().alerts);
    const stopAlerts = useAlerts.subscribe((state) => {
      const now = fired(state.alerts);
      if ([...now].some((id) => !before.has(id))) playCue('alert');
      before = now;
    });
    const offline = () => {
      playCue('offline');
    };
    window.addEventListener('offline', offline);
    return () => {
      stopAlerts();
      window.removeEventListener('offline', offline);
    };
  }, []);
}
