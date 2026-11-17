import { usePrefs, type Mode } from '../store/prefs';

const MODES: readonly (readonly [Mode, string, string])[] = [
  ['simple', 'Simple', 'Plain names, the essential panels and Learn hints'],
  ['pro', 'Pro', 'Every panel, trading labels'],
];

/** E2: Simple or Pro. Each keeps its own cockpit layout; the choice is remembered. */
export function ModeSwitch() {
  const mode = usePrefs((state) => state.mode);
  const setMode = usePrefs((state) => state.setMode);
  return (
    <div className="view-switch mode-switch" role="group" aria-label="Mode">
      {MODES.map(([id, label, title]) => (
        <button
          key={id}
          type="button"
          title={title}
          aria-pressed={mode === id}
          onClick={() => {
            setMode(id);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
