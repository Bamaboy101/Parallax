/** One panel of a preset workspace. Titles come from the widget and its params. */
export interface PresetPanel {
  id: string;
  /** Widget id. */
  component: string;
  params: Record<string, unknown>;
  position?: {
    referencePanel: string;
    direction: 'left' | 'right' | 'above' | 'below' | 'within';
  };
  /** Initial width or height in px. */
  width?: number;
  height?: number;
}

/** A preset workspace: one JSON file in this folder. */
export interface Workspace {
  id: string;
  title: string;
  description: string;
  panels: PresetPanel[];
}

const files = import.meta.glob<Workspace>('./*.json', { eager: true, import: 'default' });

/** Menu order; a preset added without an entry here goes last. */
const ORDER = ['overview', 'crypto', 'equities', 'macro'];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

export const WORKSPACES: readonly Workspace[] = Object.values(files).sort(
  (a, b) => rank(a.id) - rank(b.id),
);

/** What a first visit shows. */
export const DEFAULT_WORKSPACE = 'overview';
