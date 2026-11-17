/**
 * F6: the browser's speech recognition (Web Speech API), one short utterance at a time.
 *
 * Where recognition runs is the browser's choice. On-device recognition keeps the audio on the
 * machine; otherwise the browser sends it to its maker's online speech service (MDN: "your audio
 * is sent to a web service for recognition processing"). The terminal uses on-device recognition
 * whenever the browser offers it, and the online service only after the user agrees to it.
 */

export const VOICE_LANG = 'en-US';

/** The parts of the Web Speech API used here; not every TypeScript DOM lib declares them. */
interface Alternative {
  transcript: string;
}
interface Result {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: Alternative;
}
interface ResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: Result };
}
interface ErrorEvent {
  readonly error: string;
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface Options {
  langs: string[];
  processLocally: boolean;
}
export interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: Options) => Promise<Availability>;
  install?: (options: Options) => Promise<boolean>;
}

/** The browser's recognizer, prefixed or not; undefined where there is none (Firefox). */
export function recognitionClass(scope: object = globalThis): RecognitionConstructor | undefined {
  const candidate = scope as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
}

/**
 * Where recognition can run in this browser:
 * - `local`: on-device, the audio stays here;
 * - `download`: on-device after a one-time language download, which the user starts;
 * - `online`: only the browser's online service (on-device is unavailable or not offered).
 */
export type Route = 'local' | 'download' | 'online';

export async function routeFor(Recognizer: RecognitionConstructor): Promise<Route> {
  if (!Recognizer.available) return 'online';
  try {
    const availability = await Recognizer.available({ langs: [VOICE_LANG], processLocally: true });
    if (availability === 'available') return 'local';
    if (availability === 'downloadable' || availability === 'downloading') return 'download';
  } catch {
    // A browser that cannot answer has nothing on-device to offer.
  }
  return 'online';
}

/** Download the on-device English model. Resolves false when the browser declined. */
export async function installLocal(Recognizer: RecognitionConstructor): Promise<boolean> {
  if (!Recognizer.install) return false;
  try {
    return await Recognizer.install({ langs: [VOICE_LANG], processLocally: true });
  } catch {
    return false;
  }
}

/** What went wrong, in plain words, from the API's error codes. */
export function speechError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'The microphone is blocked for this site. Allow it in the browser, then try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'no-speech':
      return 'Nothing was heard. Press the microphone and speak after it lights up.';
    case 'network':
      return 'The browser could not reach its speech service.';
    case 'service-not-allowed':
      return 'The browser refused speech recognition for this page.';
    case 'language-not-supported':
      return 'This browser cannot recognise English speech.';
    case 'aborted':
      return 'Listening stopped.';
    default:
      return `Speech recognition failed (${code}).`;
  }
}

export interface Listening {
  stop: () => void;
}

/**
 * Listen for one utterance. `onText` gets what has been heard so far, `onFinal` the whole of it,
 * `onError` a plain-words reason; `onEnd` runs last in every case.
 */
export function listen(
  Recognizer: RecognitionConstructor,
  local: boolean,
  handlers: {
    onText: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  },
): Listening {
  const recognition = new Recognizer();
  recognition.lang = VOICE_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  if (local) recognition.processLocally = true;
  let final = false;
  recognition.onresult = (event) => {
    let text = '';
    let done = false;
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result) continue;
      text += result[0]?.transcript ?? '';
      if (result.isFinal) done = true;
    }
    if (done && !final) {
      final = true;
      handlers.onFinal(text.trim());
    } else if (!done) handlers.onText(text.trim());
  };
  recognition.onerror = (event) => {
    if (event.error !== 'aborted') handlers.onError(speechError(event.error));
  };
  recognition.onend = () => {
    handlers.onEnd();
  };
  recognition.start();
  return {
    stop: () => {
      recognition.stop();
    },
  };
}
