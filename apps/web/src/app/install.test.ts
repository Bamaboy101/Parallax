import { beforeEach, describe, expect, it, vi } from 'vitest';
import { install, setUpInstall, useInstall } from './install';

describe('installable app', () => {
  beforeEach(() => {
    useInstall.setState({ prompt: null, installed: false });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
  });

  it('keeps the browser prompt for Settings and shows it once, on request', async () => {
    setUpInstall(false);
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(useInstall.getState().prompt).toBe(event);

    await install();
    await install();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(useInstall.getState().prompt).toBeNull();
  });

  it('knows when it is running installed, and when the browser installs it', () => {
    setUpInstall(false);
    window.dispatchEvent(new Event('appinstalled'));
    expect(useInstall.getState().installed).toBe(true);
  });

  it('registers the offline shell only in production builds', () => {
    const register = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    setUpInstall(false);
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
    setUpInstall(true);
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledWith('/sw.js');
  });
});
