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
  /** Words the command bar accepts for this widget. */
  aliases: string[];
  /** False for widgets the shell places itself, such as the ticker rail. */
  dock: boolean;
  /**
   * What the command bar can hand the widget, stored in its panel params:
   * - `symbol`: one instrument (`params.symbol`), and `params.interval` for charts;
   * - `symbols`: a list it adds to (`params.symbols`);
   * - `query`: free text (`params.query`), e.g. a news search;
   * - `none`: nothing.
   */
  input: 'symbol' | 'symbols' | 'query' | 'none';
  /** Params a new panel starts with, and the base a list widget adds to. */
  defaultParams?: Readonly<Record<string, unknown>>;
}
