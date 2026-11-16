import { create } from 'zustand';

/** Linked-panel groups. Panels in one group follow the same symbol. */
export const LINK_GROUPS = [1, 2, 3, 4] as const;
export type LinkGroup = (typeof LINK_GROUPS)[number];

interface LinkState {
  /** The symbol each group last selected. */
  symbols: Partial<Record<LinkGroup, string>>;
}

export const useLinkStore = create<LinkState>()(() => ({ symbols: {} }));

/** A panel's link group from its params, if it has one. */
export function linkGroupOf(params: unknown): LinkGroup | undefined {
  if (typeof params !== 'object' || params === null || !('link' in params)) return undefined;
  return LINK_GROUPS.find((group) => group === params.link);
}

/** A widget in `group` picked a symbol: every panel in the group follows it (app/links.ts). */
export function selectLinked(group: LinkGroup | undefined, symbolId: string): void {
  if (group === undefined) return;
  useLinkStore.setState((state) => ({ symbols: { ...state.symbols, [group]: symbolId } }));
}
