import type { IDockviewPanelProps } from 'dockview-react';
import { RegionBoard } from '../RegionBoard';
import { EUROPE } from '../regionBoards';

/** Europe (M9): EUR, GBP and CHF live, then the region's indices through US-listed proxies. */
export default function Europe({ api }: IDockviewPanelProps) {
  return <RegionBoard api={api} board={EUROPE} />;
}
