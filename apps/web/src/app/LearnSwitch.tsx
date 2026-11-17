import { usePrefs } from '../store/prefs';

/** Top-bar switch for learn mode (F5): one press explains every panel, number and badge. */
export function LearnSwitch() {
  const learn = usePrefs((prefs) => prefs.learn);
  const setLearn = usePrefs((prefs) => prefs.setLearn);
  return (
    <button
      type="button"
      className="learn-switch"
      aria-pressed={learn}
      title={learn ? 'Turn off learn mode' : 'Learn mode: explain every panel, number and badge'}
      onClick={() => {
        setLearn(!learn);
      }}
    >
      Learn
    </button>
  );
}
