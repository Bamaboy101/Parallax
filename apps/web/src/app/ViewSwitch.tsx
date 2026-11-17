import { usePrefs, type View } from '../store/prefs';

const VIEWS: readonly (readonly [View, string])[] = [
  ['rundown', 'Rundown'],
  ['cockpit', 'Cockpit'],
];

/** E1: the home page or the full dock of panels. The choice is remembered. */
export function ViewSwitch() {
  const view = usePrefs((state) => state.view);
  const setView = usePrefs((state) => state.setView);
  return (
    <div className="view-switch" role="group" aria-label="View">
      {VIEWS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => {
            setView(id);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
