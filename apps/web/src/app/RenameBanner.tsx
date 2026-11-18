import { useState } from 'react';
import '../design/rename.css';
import { NEW_ORIGIN, OLD_ADDRESS_CLOSES, OPEN_TERMINAL_ORIGIN, sendHandoff } from './rename';

const NEW_HOST = new URL(NEW_ORIGIN).host;

/** Shown only at an old address: where Parallax Terminal lives now, and a way to take your setup there. */
export function RenameBanner() {
  const [blocked, setBlocked] = useState(false);
  // Visitors of the original address knew the old name; the interim address only moved.
  const renamed = window.location.origin === OPEN_TERMINAL_ORIGIN;
  return (
    <div className="rename-banner" role="region" aria-label="New address">
      <p>
        {renamed ? 'Open Terminal is now ' : ''}
        <strong>Parallax Terminal</strong>
        {renamed ? ', at ' : ' has moved to '}
        <a href={NEW_ORIGIN} target="_blank" rel="noreferrer">
          {NEW_HOST}
        </a>
        . This address closes on {OLD_ADDRESS_CLOSES}.
      </p>
      <button
        type="button"
        className="rename-banner-move"
        onClick={() => {
          setBlocked(!sendHandoff());
        }}
      >
        Move my layout and keys
      </button>
      {blocked && (
        <p className="rename-banner-note">
          The browser blocked the new window. Allow pop-ups for this site, then try again.
        </p>
      )}
    </div>
  );
}
