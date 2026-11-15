import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Truth badge for the widget's data. */
  badge?: ReactNode;
  /** Header controls, right-aligned after the badge. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Widget surface: one step lighter than the background, hairline border, no shadow. */
export function Panel({ title, badge, actions, children }: PanelProps) {
  return (
    <section
      aria-label={title}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel"
    >
      <header className="flex h-(--row-h) shrink-0 items-center gap-2 border-b border-line px-(--pad)">
        <h2 className="truncate text-label font-medium tracking-wider text-muted uppercase">
          {title}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {badge}
          {actions}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
