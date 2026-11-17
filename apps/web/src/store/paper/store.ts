import { useEffect } from 'react';
import { create } from 'zustand';
import { failureOf, type Failure } from '../failure';
import { useKeyVault } from '../keys';
import { freshnessOfFailure, reportRestFreshness } from '../panels';
import { looksLikeLiveKey, paperKeyOf, paperRequest, type PaperKey } from './client';
import {
  orderBody,
  parseAccount,
  parseOrder,
  parseOrders,
  parsePositions,
  type PaperAccount,
  type PaperOrder,
  type PaperPosition,
  type Ticket,
} from './parse';

export const PAPER_SOURCE = 'alpaca-paper';
/** Account, positions and open orders while a panel shows them. */
export const PAPER_POLL_MS = 5_000;

export interface PaperState {
  /** 'no-key': no Alpaca key saved; 'live-key': the saved key is a live key, never sent. */
  state: 'no-key' | 'live-key' | 'loading' | 'ready' | 'error';
  account: PaperAccount | null;
  positions: PaperPosition[];
  orders: PaperOrder[];
  failure: Failure | undefined;
  updatedAt: number | null;
}

const INITIAL: PaperState = {
  state: 'loading',
  account: null,
  positions: [],
  orders: [],
  failure: undefined,
  updatedAt: null,
};

export const usePaperStore = create<PaperState>()(() => INITIAL);

/** The saved Alpaca key, or the reason there is none to use. */
function currentKey(): PaperKey | 'no-key' | 'live-key' {
  const key = paperKeyOf(useKeyVault.getState().keys.alpaca);
  if (!key) return 'no-key';
  return looksLikeLiveKey(key.id) ? 'live-key' : key;
}

let refreshing: Promise<void> | null = null;

/** Fetch account, positions and open orders; one refresh at a time. */
export function refreshPaper(): Promise<void> {
  refreshing ??= (async () => {
    const key = currentKey();
    if (key === 'no-key' || key === 'live-key') {
      usePaperStore.setState({ ...INITIAL, state: key });
      return;
    }
    try {
      const [account, positions, orders] = await Promise.all([
        paperRequest(key, '/v2/account'),
        paperRequest(key, '/v2/positions'),
        paperRequest(key, '/v2/orders?status=open&limit=100&direction=desc'),
      ]);
      usePaperStore.setState({
        state: 'ready',
        account: parseAccount(account),
        positions: parsePositions(positions),
        orders: parseOrders(orders),
        failure: undefined,
        updatedAt: Date.now(),
      });
      reportRestFreshness(PAPER_SOURCE, { kind: 'polled', everyMs: PAPER_POLL_MS });
    } catch (error) {
      const failure = failureOf(error);
      reportRestFreshness(PAPER_SOURCE, freshnessOfFailure(failure));
      // A failed refresh keeps what is shown; the panel says why it is old.
      usePaperStore.setState((current) => ({
        state: current.account ? 'ready' : 'error',
        failure,
      }));
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export type OrderResult = { ok: true; order: PaperOrder } | { ok: false; message: string };

/** Send a paper order; the account refreshes right after. */
export async function placePaperOrder(ticket: Ticket): Promise<OrderResult> {
  const built = orderBody(ticket);
  if ('error' in built) return { ok: false, message: built.error };
  const key = currentKey();
  if (key === 'no-key')
    return { ok: false, message: 'Add your Alpaca paper key in Settings first.' };
  if (key === 'live-key') {
    return {
      ok: false,
      message: 'The saved Alpaca key is a live-trading key; paper trading needs your paper key.',
    };
  }
  try {
    const order = parseOrder(
      await paperRequest(key, '/v2/orders', { method: 'POST', body: built.body }),
    );
    if (!order) return { ok: false, message: 'Alpaca paper answered without an order.' };
    void refreshPaper();
    return { ok: true, order };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The order was not sent.',
    };
  }
}

/** Cancel an open paper order. */
export async function cancelPaperOrder(id: string): Promise<{ ok: boolean; message?: string }> {
  const key = currentKey();
  if (key === 'no-key' || key === 'live-key') return { ok: false, message: 'No paper key saved.' };
  try {
    await paperRequest(key, `/v2/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void refreshPaper();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The order was not cancelled.',
    };
  }
}

let users = 0;
let timer: number | undefined;

/** Keeps the paper account fresh while any panel or ticket shows it. */
export function usePaperFeed(): void {
  const stored = useKeyVault((state) => state.keys.alpaca);
  useEffect(() => {
    users += 1;
    if (users === 1) timer = window.setInterval(() => void refreshPaper(), PAPER_POLL_MS);
    return () => {
      users -= 1;
      if (users === 0) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
  }, []);
  // A new or removed key refreshes at once.
  useEffect(() => {
    void refreshPaper();
  }, [stored]);
}
