import { useCallback, useRef, useState } from 'react';

const SUPPORTED = typeof IntersectionObserver !== 'undefined';
const NONE: ReadonlySet<string> = new Set();

/**
 * Which rows of a scrolling list are on screen. Attach `root` to the scroll container and `row`
 * to each row element, which carries its id in `data-row`. A row scrolled away, or in a panel
 * whose tab is hidden, is off screen, so it can subscribe in the background and leave capped
 * stream slots to what the user is looking at. Without IntersectionObserver (tests), every row
 * counts as on screen.
 */
export function useVisibleRows() {
  const [visible, setVisible] = useState<ReadonlySet<string>>(NONE);
  const observer = useRef<IntersectionObserver | null>(null);
  const rows = useRef(new Set<Element>());

  const root = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || !SUPPORTED) return;
    const created = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const id = entry.target instanceof HTMLElement ? entry.target.dataset.row : undefined;
            if (id === undefined) continue;
            if (entry.isIntersecting) next.add(id);
            else next.delete(id);
          }
          const same = next.size === current.size && [...next].every((id) => current.has(id));
          return same ? current : next;
        });
      },
      { root: element },
    );
    for (const row of rows.current) created.observe(row);
    observer.current = created;
  }, []);

  const row = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    rows.current.add(element);
    observer.current?.observe(element);
    return () => {
      rows.current.delete(element);
      observer.current?.unobserve(element);
    };
  }, []);

  const isVisible = useCallback((id: string) => !SUPPORTED || visible.has(id), [visible]);
  return { root, row, isVisible };
}
