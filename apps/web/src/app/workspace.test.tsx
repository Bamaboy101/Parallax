import { render } from '@testing-library/react';
import { DockviewReact, type DockviewApi } from 'dockview-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_SINCE, resetTicks, useTickStore } from '../store/ticks';
import { WORKSPACES } from '../workspaces';
import { applyPreset } from './dockLayout';
import { DOCK_COMPONENTS } from './widgets';
import {
  decodeShare,
  encodeShare,
  loadWorkspace,
  notify,
  openSharedWorkspace,
  parseWorkspace,
  shareToken,
  shareUrl,
  useWorkspaceNotice,
  workspaceFile,
} from './workspace';

const stub = Object.fromEntries(Object.keys(DOCK_COMPONENTS).map((id) => [id, () => null]));

function mountDock(): DockviewApi {
  let api: DockviewApi | undefined;
  render(
    <DockviewReact
      components={stub}
      onReady={(event) => {
        api = event.api;
      }}
    />,
  );
  if (!api) throw new Error('dockview did not become ready');
  return api;
}

const ids = (api: DockviewApi) => api.panels.map((panel) => panel.id).sort();
const presetIds = (id: string) =>
  (WORKSPACES.find((workspace) => workspace.id === id)?.panels ?? [])
    .map((panel) => panel.id)
    .sort();

afterEach(() => {
  resetTicks();
  notify(null);
});

describe('share links', () => {
  it('round-trips a workspace and its Rewind moment through a short URL-safe token', async () => {
    const api = mountDock();
    applyPreset(api, 'crypto');
    const file = workspaceFile(api, 1_800_000_000_000);

    const token = await encodeShare(file);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // Small enough for chat apps and browsers to keep whole.
    expect(
      shareUrl({ origin: 'https://open-terminal.pages.dev', pathname: '/' }, token).length,
    ).toBeLessThan(4000);
    expect(await decodeShare(token)).toEqual(file);
    expect(shareToken(`#w=${token}`)).toBe(token);
  });

  it('rejects a damaged token', async () => {
    expect(await decodeShare('not-a-workspace')).toBeNull();
  });

  it('opens a shared workspace, clears the hash, and keeps an unreachable Rewind moment live', async () => {
    const source = mountDock();
    applyPreset(source, 'macro');
    const token = await encodeShare(workspaceFile(source, HISTORY_SINCE - 60_000));

    const api = mountDock();
    applyPreset(api, 'overview');
    const replaceState = vi.fn();
    await openSharedWorkspace(
      api,
      { hash: `#w=${token}`, pathname: '/', search: '' },
      { replaceState },
    );

    expect(ids(api)).toEqual(presetIds('macro'));
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(useTickStore.getState().cursor).toBeNull();
    expect(useWorkspaceNotice.getState().notice).toMatch(/before this page opened/);
  });

  it('applies a shared Rewind moment this page has data for', async () => {
    const api = mountDock();
    applyPreset(api, 'crypto');
    // Any moment since this page (the test module) opened is in its history.
    const at = HISTORY_SINCE;
    const token = await encodeShare(workspaceFile(api, at));
    await openSharedWorkspace(
      api,
      { hash: `#w=${token}`, pathname: '/', search: '' },
      { replaceState: vi.fn() },
    );
    expect(useTickStore.getState().cursor).toBe(at);
  });
});

describe('layout files', () => {
  it('accepts our file or a bare dockview layout, and nothing else', () => {
    const api = mountDock();
    applyPreset(api, 'overview');
    const dock = api.toJSON();
    expect(parseWorkspace(workspaceFile(api, null))?.dock).toEqual(dock);
    expect(parseWorkspace(dock)?.dock).toEqual(dock);
    expect(parseWorkspace({ hello: 'world' })).toBeNull();
    expect(parseWorkspace([])).toBeNull();
  });

  it('leaves the current layout in place when a file does not load', () => {
    const api = mountDock();
    applyPreset(api, 'overview');
    const broken = workspaceFile(api, null);
    for (const panel of Object.values(broken.dock.panels)) panel.contentComponent = 'removed';

    expect(loadWorkspace(api, broken)).toBe(false);
    expect(ids(api)).toEqual(presetIds('overview'));
  });
});
