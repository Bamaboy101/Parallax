/**
 * Every widget folder has a `meta.ts` exporting `meta: WidgetMeta` and an `index.tsx` whose
 * default export is the widget. The app finds both by file pattern, so adding a widget touches no
 * shared file.
 */
export interface WidgetMeta {
  /** Stable id: the dock component name and the key in saved layouts. */
  id: string;
  title: string;
  /** Initial size in px when the widget is added to the dock. */
  defaultSize: { width: number; height: number };
  /** Words the command bar (T11) accepts for this widget. */
  aliases: string[];
  /** False for widgets the shell places itself, such as the ticker rail. */
  dock: boolean;
}
