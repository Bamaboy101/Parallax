import { useEffect, useState } from 'react';

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** Local wall clock, ticking on the second boundary. */
export function Clock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: number;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      timer = window.setTimeout(tick, 1000 - (current % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <time dateTime={new Date(now).toISOString()} className="font-mono text-num text-muted">
      {timeFormat.format(now)}
    </time>
  );
}
