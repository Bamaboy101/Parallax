import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { formatNumber } from '../../design/format';
import { sourceName } from '../../design/sources';
import type { Bar } from '../../feeds/types';
import { cachedHistory, loadHistory } from '../history';
import {
  lastPriceOf,
  priceChannel,
  priceHistorySpan,
  priceLine,
  usePriceSubscriptions,
} from '../hooks';
import { isReplaying } from '../recorder';
import { instrument, type Instrument } from '../symbols';
import { sampleAt, useTickStore } from '../ticks';
import { describeRule, type AlertRule } from './parse';

export const ALERTS_STORAGE_KEY = 'parallax:alerts';
/** Rules are checked this often against the latest prices. */
export const ALERT_CHECK_MS = 1000;

export interface Alert {
  id: string;
  rule: AlertRule;
  createdAt: number;
  /**
   * new: no price seen yet. waiting: the condition was already true when the alert was added,
   * so it first has to stop being true. armed: fires the next time the condition holds.
   * fired: done; re-arm to use it again.
   */
  status: 'new' | 'waiting' | 'armed' | 'fired';
  fired?: { at: number; price: number; source: string; detail: string };
}

interface AlertsState {
  alerts: Alert[];
  add: (rule: AlertRule, now?: number) => void;
  remove: (id: string) => void;
  rearm: (id: string) => void;
}

export const useAlerts = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      add: (rule, now = Date.now()) => {
        set((state) => ({
          alerts: [
            ...state.alerts,
            { id: crypto.randomUUID(), rule, createdAt: now, status: 'new' },
          ],
        }));
      },
      remove: (id) => {
        set((state) => ({ alerts: state.alerts.filter((alert) => alert.id !== id) }));
      },
      rearm: (id) => {
        set((state) => ({
          alerts: state.alerts.map((alert): Alert =>
            alert.id === id
              ? { id: alert.id, rule: alert.rule, createdAt: alert.createdAt, status: 'new' }
              : alert,
          ),
        }));
      },
    }),
    {
      name: ALERTS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ alerts: state.alerts }),
    },
  ),
);

/** What the engine knows about a symbol right now. */
export interface AlertInputs {
  price: number;
  source: string;
  /** The price at the start of a move alert's window, if the page saw that far back. */
  priceAt: (time: number) => number | undefined;
  /** 24 h (crypto, FX) or since-close (stocks) change in percent, once history has loaded. */
  dayChangePct: number | undefined;
}

/** Whether the rule's condition holds now; undefined when it cannot be judged yet. */
export function conditionHolds(
  rule: AlertRule,
  inputs: AlertInputs,
  now: number,
): boolean | undefined {
  const meets = (change: number) =>
    rule.kind === 'level'
      ? false
      : rule.direction === 'up'
        ? change >= rule.percent
        : rule.direction === 'down'
          ? change <= -rule.percent
          : Math.abs(change) >= rule.percent;
  switch (rule.kind) {
    case 'level':
      return rule.direction === 'above' ? inputs.price > rule.level : inputs.price < rule.level;
    case 'move': {
      const start = inputs.priceAt(now - rule.windowMs);
      return start === undefined || start === 0
        ? undefined
        : meets((inputs.price / start - 1) * 100);
    }
    case 'day':
      return inputs.dayChangePct === undefined ? undefined : meets(inputs.dayChangePct);
  }
}

/**
 * The alert's next state. An alert only fires on a fresh crossing: if its condition is already
 * true when it is added, it waits for it to stop being true first, so adding "BTC above 60000"
 * while BTC is at 64,000 does not go off at once.
 */
export function nextState(alert: Alert, holds: boolean | undefined): Alert['status'] {
  if (holds === undefined || alert.status === 'fired') return alert.status;
  switch (alert.status) {
    case 'new':
      return holds ? 'waiting' : 'armed';
    case 'waiting':
      return holds ? 'waiting' : 'armed';
    case 'armed':
      return holds ? 'fired' : 'armed';
  }
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "BTC/USD at 65,012.40 on Coinbase, 14:05:12." */
export function firedDetail(
  item: Instrument | undefined,
  price: number,
  source: string,
  at: number,
): string {
  return `${item?.label ?? ''} at ${formatNumber(price, item?.decimals ?? 2)} on ${sourceName(source)}, ${timeFormat.format(at)}.`;
}

/** A browser notification, when the user allowed them; the Alerts panel shows every alert anyway. */
function notify(alert: Alert, detail: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(`Parallax: ${describeRule(alert.rule)}`, { body: detail, tag: alert.id });
}

/**
 * Check every unfired alert against the latest prices. Live only: Rewind does not fire alerts,
 * and neither does a replayed session (F10).
 */
export function checkAlerts(now = Date.now()): void {
  if (isReplaying()) return;
  const state = useTickStore.getState();
  const { alerts } = useAlerts.getState();
  const next = alerts.map((alert): Alert => {
    if (alert.status === 'fired') return alert;
    const item = instrument(alert.rule.symbol);
    if (!item) return alert;
    const channel = priceChannel(item);
    const tick = state.latest[channel][item.id];
    if (!tick) return alert;
    const last = lastPriceOf(tick);
    const bars: readonly Bar[] = cachedHistory(item, '1h', priceHistorySpan(item))?.bars ?? [];
    const holds = conditionHolds(
      alert.rule,
      {
        price: last.price,
        source: last.source,
        priceAt: (time) => {
          const sample = sampleAt(channel, item.id, [time])[0];
          return sample ? lastPriceOf(sample).price : undefined;
        },
        dayChangePct: bars.length > 0 ? priceLine(item, last, bars).changePct : undefined,
      },
      now,
    );
    const status = nextState(alert, holds);
    if (status === alert.status) return alert;
    if (status !== 'fired') return { ...alert, status };
    const detail = firedDetail(item, last.price, last.source, now);
    const fired: Alert = {
      ...alert,
      status,
      fired: { at: now, price: last.price, source: last.source, detail },
    };
    notify(fired, detail);
    return fired;
  });
  if (next.some((alert, index) => alert !== alerts[index])) useAlerts.setState({ alerts: next });
}

/**
 * Runs the alerts while the terminal is open, whatever panels are showing: keeps their symbols
 * streaming, loads day history for day alerts, and checks once a second.
 */
export function useAlertEngine(): void {
  const alerts = useAlerts((state) => state.alerts);
  const live = alerts.filter((alert) => alert.status !== 'fired');
  const items = [...new Set(live.map((alert) => alert.rule.symbol))].flatMap((id) => {
    const item = instrument(id);
    return item ? [item] : [];
  });
  usePriceSubscriptions(items);
  const dayKey = [
    ...new Set(live.filter((alert) => alert.rule.kind === 'day').map((alert) => alert.rule.symbol)),
  ].join(',');
  useEffect(() => {
    const load = () => {
      for (const id of dayKey.split(',').filter(Boolean)) {
        const item = instrument(id);
        if (item) loadHistory(item, '1h', priceHistorySpan(item));
      }
    };
    load();
    const timer = window.setInterval(load, 15 * 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [dayKey]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      checkAlerts();
    }, ALERT_CHECK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
}
