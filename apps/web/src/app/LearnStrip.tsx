import type { ReactNode } from 'react';
import '../design/learn.css';
import { badgeExplanation } from '../design/learn';
import { useFreshness, usePanelSources } from '../store/panels';
import { usePrefs } from '../store/prefs';

/** What this panel's truth badges mean right now, one sentence per feed. */
function BadgeMeaning({ panelId }: { panelId: string }) {
  const sources = usePanelSources(panelId);
  const freshness = useFreshness(sources);
  if (sources.length === 0) return null;
  return (
    <ul className="learn-badges" aria-label="What the badge means">
      {sources.map((source, index) => {
        const state = freshness[index];
        return state ? <li key={source}>{badgeExplanation(state, source)}</li> : null;
      })}
    </ul>
  );
}

/**
 * Every dock panel sits in this frame. With learn mode on (F5) a strip above the panel says what
 * it shows and what its badge means; hover or focus any number or label for its meaning. The frame
 * is always there, so switching learn mode never remounts the widget.
 */
export function LearnFrame({
  panelId,
  explanation,
  children,
}: {
  panelId: string;
  explanation: string;
  children: ReactNode;
}) {
  const learn = usePrefs((prefs) => prefs.learn);
  return (
    <div className="learn-frame">
      {learn && (
        <aside className="learn-strip" aria-label="Learn mode">
          <p>{explanation}</p>
          <BadgeMeaning panelId={panelId} />
        </aside>
      )}
      <div className="learn-body">{children}</div>
    </div>
  );
}
