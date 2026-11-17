import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { usePrefs } from '../store/prefs';

// jsdom has no ResizeObserver; dockview needs one to mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// A fresh jsdom has no saved layout, so the prefs start as a first visit (Rundown, Simple, Learn).
// Tests describe the terminal as a returning user has it unless they set the mode themselves.
beforeEach(() => {
  usePrefs.setState({ view: 'cockpit', mode: 'pro', learn: false });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
