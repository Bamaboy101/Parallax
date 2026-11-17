/** Window event the shell answers by opening Settings; widgets never import the shell. */
export const OPEN_SETTINGS_EVENT = 'parallax:open-settings';

export function requestSettings(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}
