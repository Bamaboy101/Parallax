import { useEffect, useState } from 'react';
import { isObject } from '../feeds/adapters/parse';
import { edgeJson } from './edge';
import { failureOf, type Failure } from './failure';
import type { Observation } from './macro';
import { freshnessOfFailure, reportRestFreshness } from './panels';

/** The edge caches EIA for an hour; EIA publishes weekly (petroleum Wednesday, gas Thursday). */
export const ENERGY_REFRESH_MS = 60 * 60_000;

export interface EnergySeries {
  cadence: 'weekly' | 'daily';
  /** EIA's own description, e.g. "U.S. Ending Stocks excluding SPR of Crude Oil (Thousand Barrels)". */
  description: string;
  /** EIA's unit code: 'MBBL', 'MBBL/D', 'BCF', '%', '$/BBL', '$/MMBTU'. */
  units: string;
  /** Oldest first. */
  observations: readonly Observation[];
}

export type EnergyMap = Readonly<Record<string, EnergySeries>>;

/** One row of the Energy panel: the EIA series, its labels in Pro and Simple, and its display unit. */
export interface EnergyRow {
  id: string;
  label: string;
  plain: string;
  /** Divide EIA's value by this before showing it (thousand barrels → million barrels). */
  scale: number;
  unit: string;
  decimals: number;
}

export const STOCK_ROWS: readonly EnergyRow[] = [
  {
    id: 'PET.WCESTUS1.W',
    label: 'Crude stocks (ex-SPR)',
    plain: 'Crude oil in storage',
    scale: 1000,
    unit: 'M bbl',
    decimals: 1,
  },
  {
    id: 'PET.WGTSTUS1.W',
    label: 'Gasoline stocks',
    plain: 'Gasoline in storage',
    scale: 1000,
    unit: 'M bbl',
    decimals: 1,
  },
  {
    id: 'PET.WDISTUS1.W',
    label: 'Distillate stocks',
    plain: 'Diesel and heating oil in storage',
    scale: 1000,
    unit: 'M bbl',
    decimals: 1,
  },
  {
    id: 'PET.WCSSTUS1.W',
    label: 'SPR',
    plain: 'Emergency oil reserve',
    scale: 1000,
    unit: 'M bbl',
    decimals: 1,
  },
  {
    id: 'NG.NW2_EPG0_SWO_R48_BCF.W',
    label: 'Gas storage (Lower 48)',
    plain: 'Natural gas in storage',
    scale: 1,
    unit: 'Bcf',
    decimals: 0,
  },
];

export const SUPPLY_ROWS: readonly EnergyRow[] = [
  {
    id: 'PET.WCRFPUS2.W',
    label: 'Crude production',
    plain: 'Oil pumped per day',
    scale: 1000,
    unit: 'M bbl/d',
    decimals: 2,
  },
  {
    id: 'PET.WPULEUS3.W',
    label: 'Refinery utilisation',
    plain: 'Refineries in use',
    scale: 1,
    unit: '%',
    decimals: 1,
  },
];

export const PRICE_ROWS: readonly EnergyRow[] = [
  {
    id: 'PET.RWTC.D',
    label: 'WTI spot (Cushing)',
    plain: 'US oil price',
    scale: 1,
    unit: '$/bbl',
    decimals: 2,
  },
  {
    id: 'NG.RNGWHHD.D',
    label: 'Henry Hub spot',
    plain: 'US natural gas price',
    scale: 1,
    unit: '$/MMBtu',
    decimals: 2,
  },
];

/** The edge's `/eia` answer → series by id; null when it is not one. */
export function parseEnergy(body: unknown): EnergyMap | null {
  if (!isObject(body) || !isObject(body.series)) return null;
  const series: Record<string, EnergySeries> = {};
  for (const [id, raw] of Object.entries(body.series)) {
    if (!isObject(raw) || !Array.isArray(raw.observations)) continue;
    series[id] = {
      cadence: raw.cadence === 'daily' ? 'daily' : 'weekly',
      description: typeof raw.description === 'string' ? raw.description : '',
      units: typeof raw.units === 'string' ? raw.units : '',
      observations: raw.observations.flatMap((entry): Observation[] =>
        isObject(entry) && typeof entry.date === 'string' && typeof entry.value === 'number'
          ? [{ date: entry.date, value: entry.value }]
          : [],
      ),
    };
  }
  return series;
}

const DAY_MS = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The observation nearest `target` within three days, with the one before it. */
function weekAt(observations: readonly Observation[], target: number) {
  let best = -1;
  for (let index = 1; index < observations.length; index += 1) {
    const at = observations[index];
    if (!at) continue;
    const distance = Math.abs(time(at.date) - target);
    if (distance <= 3 * DAY_MS) {
      const current = observations[best];
      if (!current || distance < Math.abs(time(current.date) - target)) best = index;
    }
  }
  const at = observations[best];
  const before = observations[best - 1];
  return at && before ? { at, before } : undefined;
}

export interface EnergyStat {
  value: number;
  /** Change from the previous observation (the week before, or the day before). */
  change: number | undefined;
  /**
   * Weekly series: this week's change minus the average change in the same week of the previous
   * five years (the seasonal norm); undefined with fewer than three of those years on record.
   */
  vsNorm: number | undefined;
  /** How many earlier years went into the norm. */
  normYears: number;
  asOf: string;
}

/** The latest figure of a series, its change, and (weekly) its change against the five-year norm. */
export function energyStat(series: EnergySeries | undefined): EnergyStat | undefined {
  const observations = series?.observations ?? [];
  const last = observations.at(-1);
  if (!last) return undefined;
  const previous = observations.at(-2);
  const change = previous ? last.value - previous.value : undefined;
  if (series?.cadence !== 'weekly' || change === undefined) {
    return { value: last.value, change, vsNorm: undefined, normYears: 0, asOf: last.date };
  }
  const changes = [1, 2, 3, 4, 5].flatMap((years) => {
    const week = weekAt(observations, time(last.date) - years * 364 * DAY_MS);
    return week ? [week.at.value - week.before.value] : [];
  });
  const norm = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return {
    value: last.value,
    change,
    vsNorm: changes.length >= 3 ? change - norm : undefined,
    normYears: changes.length,
    asOf: last.date,
  };
}

/** The Energy panel's series, through the edge (its hour-long cache answers repeat requests). */
export async function fetchEnergy(): Promise<EnergyMap> {
  const series = parseEnergy(await edgeJson('/eia'));
  if (!series) throw new Error('unreadable EIA answer');
  return series;
}

export interface EnergyState {
  state: 'loading' | 'ready' | 'error';
  series: EnergyMap;
  failure: Failure | undefined;
}

/** EIA's weekly storage, supply and spot prices, refreshed hourly. */
export function useEnergy(): EnergyState {
  const [energy, setEnergy] = useState<EnergyState>({
    state: 'loading',
    series: {},
    failure: undefined,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const series = await fetchEnergy();
        if (cancelled) return;
        reportRestFreshness('eia', { kind: 'eod', cadence: 'weekly' });
        setEnergy({ state: 'ready', series, failure: undefined });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness('eia', freshnessOfFailure(failure));
        // A failed refresh keeps the figures already shown.
        setEnergy((current) => ({
          state: current.state === 'ready' ? 'ready' : 'error',
          series: current.series,
          failure,
        }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), ENERGY_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return energy;
}
