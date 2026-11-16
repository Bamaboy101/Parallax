import type { IDockviewPanelProps } from 'dockview-react';
import { RegionBoard } from '../RegionBoard';
import { ASIA_PACIFIC } from '../regionBoards';

/** Asia-Pacific (M9): JPY and AUD live, TAIEX's official close, the rest through US proxies. */
export default function AsiaPacific({ api }: IDockviewPanelProps) {
  return <RegionBoard api={api} board={ASIA_PACIFIC} />;
}
