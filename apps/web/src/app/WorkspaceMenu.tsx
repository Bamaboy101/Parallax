import { useEffect, useRef } from 'react';
import { usePrefs } from '../store/prefs';
import { useTickStore } from '../store/ticks';
import { presetsFor } from './modes';
import { dockApi } from './dockApi';
import { applyPreset } from './dockLayout';
import {
  encodeShare,
  loadWorkspace,
  notify,
  parseWorkspace,
  shareUrl,
  useWorkspaceNotice,
  workspaceFile,
} from './workspace';

const NOTICE_MS = 8_000;

/**
 * Top-bar workspace switcher: the presets of the current mode (E2), a share link (layout, symbols
 * and Rewind moment in the URL), and layout export and import as a JSON file.
 */
export function WorkspaceMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const notice = useWorkspaceNotice((state) => state.notice);
  const mode = usePrefs((state) => state.mode);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => {
      notify(null);
    }, NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const close = () => {
    if (menu.current) menu.current.open = false;
  };

  /** The current layout and Rewind moment, or undefined before the dock is ready. */
  const current = () => {
    const api = dockApi();
    return api ? workspaceFile(api, useTickStore.getState().cursor) : undefined;
  };

  const copyLink = async () => {
    close();
    const workspace = current();
    if (!workspace) return;
    const url = shareUrl(window.location, await encodeShare(workspace));
    try {
      await navigator.clipboard.writeText(url);
      notify('Share link copied: it opens this exact layout, live, with no account.');
    } catch {
      notify(`Copy failed. The link is: ${url}`);
    }
  };

  const download = () => {
    close();
    const workspace = current();
    if (!workspace) return;
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'parallax-workspace.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importFile = async (chosen: File | undefined) => {
    close();
    const api = dockApi();
    if (!chosen || !api) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await chosen.text());
    } catch {
      notify(`${chosen.name} is not JSON.`);
      return;
    }
    const workspace = parseWorkspace(parsed);
    if (!workspace) {
      notify(`${chosen.name} is not a Parallax layout.`);
      return;
    }
    notify(
      loadWorkspace(api, workspace)
        ? `Opened ${chosen.name}.`
        : `${chosen.name} does not load in this version; your layout is unchanged.`,
    );
  };

  return (
    <div className="workspace">
      <details ref={menu} className="workspace-menu">
        <summary>Workspace</summary>
        <div className="workspace-panel">
          <ul aria-label="Preset workspaces">
            {presetsFor(mode).map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    const api = dockApi();
                    if (api) applyPreset(api, workspace.id);
                  }}
                >
                  <span className="workspace-name">{workspace.title}</span>
                  <span className="workspace-description">{workspace.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="workspace-actions">
            <button type="button" onClick={() => void copyLink()}>
              Copy share link
            </button>
            <button type="button" onClick={download}>
              Download layout file
            </button>
            <button type="button" onClick={() => file.current?.click()}>
              Open layout file…
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      </details>
      <span className="workspace-notice" role="status" aria-live="polite">
        {notice}
      </span>
    </div>
  );
}
