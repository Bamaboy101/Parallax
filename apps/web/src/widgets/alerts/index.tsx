import type { IDockviewPanelProps } from 'dockview-react';
import { useState } from 'react';
import '../../design/alerts.css';
import '../../design/market.css';
import '../../design/panels.css';
import { describeRule, parseAlert } from '../../store/alerts/parse';
import { useAlerts, type Alert } from '../../store/alerts/store';

interface AlertsParams {
  query?: string;
}

type Permission = NotificationPermission | 'unsupported';

const permissionNow = (): Permission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

const STATUS: Record<Alert['status'], string> = {
  new: 'Waiting for a price',
  waiting: 'Already true when added: fires the next time it happens',
  armed: 'Watching',
  fired: 'Happened',
};

function PermissionLine({ permission, onAsk }: { permission: Permission; onAsk: () => void }) {
  switch (permission) {
    case 'granted':
      return <p className="alerts-permission">Browser notifications are on.</p>;
    case 'denied':
      return (
        <p className="alerts-permission">
          Browser notifications are blocked for this site; alerts still show here. Allow them in
          your browser’s site settings.
        </p>
      );
    case 'unsupported':
      return (
        <p className="alerts-permission">
          This browser has no notifications; alerts show here only.
        </p>
      );
    default:
      return (
        <p className="alerts-permission">
          Notifications are not allowed yet.{' '}
          <button type="button" className="chart-interval" onClick={onAsk}>
            Allow notifications
          </button>
        </p>
      );
  }
}

/**
 * Smart alerts (F7): plain-word rules checked against live prices while the terminal is open,
 * delivered as browser notifications and listed here.
 */
export default function Alerts({ params }: IDockviewPanelProps<AlertsParams>) {
  const alerts = useAlerts((state) => state.alerts);
  const add = useAlerts((state) => state.add);
  const remove = useAlerts((state) => state.remove);
  const rearm = useAlerts((state) => state.rearm);
  const [text, setText] = useState(params.query ?? '');
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const parsed = text.trim() === '' ? null : parseAlert(text);

  const ask = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(setPermission);
  };

  return (
    <div className="market-panel alerts-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">Alerts</span>
        <span className="panel-caption">Plain words · live prices · while this tab is open</span>
      </div>
      <form
        className="alerts-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed?.ok) return;
          add(parsed.rule);
          setText('');
          // Asking on a click is the only way browsers allow it.
          if (permission === 'default') ask();
        }}
      >
        <input
          type="text"
          aria-label="New alert"
          placeholder="BTC above 65000 · ETH down 2% in 15m · SPY up 1% today"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit" className="chart-interval" disabled={!parsed?.ok}>
          Add
        </button>
      </form>
      {parsed && (
        <p className={parsed.ok ? 'alerts-preview' : 'alerts-preview is-invalid'} role="status">
          {parsed.ok ? `Tell me when ${describeRule(parsed.rule)}.` : parsed.reason}
        </p>
      )}
      <PermissionLine permission={permission} onAsk={ask} />
      {alerts.length === 0 ? (
        <p className="panel-empty">No alerts yet.</p>
      ) : (
        <ul className="alerts-list" aria-label="Your alerts">
          {[...alerts].reverse().map((alert) => (
            <li key={alert.id} className="alerts-item" data-status={alert.status}>
              <span className="alerts-rule">{describeRule(alert.rule)}</span>
              <span className="alerts-status">
                {alert.status === 'fired' && alert.fired
                  ? `Happened: ${alert.fired.detail}`
                  : STATUS[alert.status]}
              </span>
              <span className="alerts-actions">
                {alert.status === 'fired' && (
                  <button
                    type="button"
                    className="chart-interval"
                    onClick={() => {
                      rearm(alert.id);
                    }}
                  >
                    Re-arm
                  </button>
                )}
                <button
                  type="button"
                  className="chart-interval"
                  aria-label={`Remove alert: ${describeRule(alert.rule)}`}
                  onClick={() => {
                    remove(alert.id);
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-footnote">
        Alerts are checked once a second against the same live prices as the panels, in this tab:
        they work while Parallax is open (in the background is fine), not after it is closed. Each
        fires once on a fresh crossing; re-arm it to watch again. Move alerts reach back at most an
        hour.
      </p>
    </div>
  );
}
