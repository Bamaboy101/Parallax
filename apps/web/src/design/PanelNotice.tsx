import './panels.css';
import type { Notice } from './notices';
import { requestSettings } from './settingsRequest';

/**
 * A panel's empty, no-key, rate-limited or offline state: one sentence on what is missing and
 * one on what happens next, with a Settings button when a key would fix it.
 */
export function PanelNotice({ notice, compact = false }: { notice: Notice; compact?: boolean }) {
  return (
    <div
      className={compact ? 'panel-notice is-compact' : 'panel-notice'}
      data-tone={notice.tone}
      role={notice.tone === 'info' ? 'status' : 'alert'}
    >
      <span className="panel-notice-mark" aria-hidden="true" />
      <p className="panel-notice-title">{notice.title}</p>
      {notice.detail && <p className="panel-notice-detail">{notice.detail}</p>}
      {notice.action === 'settings' && (
        <button type="button" className="panel-notice-action" onClick={requestSettings}>
          Open Settings
        </button>
      )}
    </div>
  );
}
