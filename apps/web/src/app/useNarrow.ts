import { useSyncExternalStore } from 'react';

/** The phone breakpoint, the same as the narrow-screen CSS (`max-width: 760px`). */
const NARROW = '(max-width: 760px)';

function subscribe(notify: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', notify);
  return () => {
    query.removeEventListener('change', notify);
  };
}

/** E5: true on phone-width screens; follows rotation and window resizes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches);
}
