/**
 * F3 world globe: where the sun is, which exchanges are open, and which markets moved most. Pure,
 * so the drawing only maps these onto the sphere.
 */

/** Degrees: [longitude, latitude]. */
export type LonLat = readonly [number, number];

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** 2000-01-01 12:00 UTC (J2000.0), epoch ms. */
const J2000_MS = Date.UTC(2000, 0, 1, 12);

const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/**
 * The point where the sun is overhead at `now`: the centre of the day side. The low-precision
 * solar position from the Astronomical Almanac, good to about 0.01° for years around 2000, far
 * finer than a panel can show.
 */
export function subsolarPoint(now: number): LonLat {
  const n = (now - J2000_MS) / DAY_MS;
  const meanLongitude = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  // Greenwich mean sidereal time: how far the Earth has turned under the stars.
  const siderealTime = 280.46061837 + 360.98564736629 * n;
  return [wrap180(rightAscension / RAD - siderealTime), declination / RAD];
}

/** The point opposite the sun: the centre of the night side. */
export function antisolarPoint(now: number): LonLat {
  const [lon, lat] = subsolarPoint(now);
  return [wrap180(lon + 180), -lat];
}

/** Whether the sun is up at a point: within 90° of the subsolar point. */
export function inDaylight(point: LonLat, now: number): boolean {
  const [sunLon, sunLat] = subsolarPoint(now);
  const [lon, lat] = point;
  const cos =
    Math.sin(lat * RAD) * Math.sin(sunLat * RAD) +
    Math.cos(lat * RAD) * Math.cos(sunLat * RAD) * Math.cos((lon - sunLon) * RAD);
  return cos > 0;
}

/** Exchanges from the session model (store/sessions.ts), at their cities. */
export const EXCHANGES: readonly { session: string; city: string; at: LonLat }[] = [
  { session: 'sydney', city: 'Sydney', at: [151.21, -33.87] },
  { session: 'tokyo', city: 'Tokyo', at: [139.69, 35.69] },
  { session: 'hong-kong', city: 'Hong Kong', at: [114.17, 22.28] },
  { session: 'mumbai', city: 'Mumbai', at: [72.88, 19.08] },
  { session: 'frankfurt', city: 'Frankfurt', at: [8.68, 50.11] },
  { session: 'london', city: 'London', at: [-0.13, 51.51] },
  { session: 'new-york', city: 'New York', at: [-74.01, 40.71] },
];

/** Where the US-listed country ETFs (the proxies on the region boards) trade. */
export const NEW_YORK: LonLat = [-74.01, 40.71];

/** One market on the globe through its US-listed ETF proxy (catalogue id). */
export interface CountryProxy {
  country: string;
  proxy: string;
  at: LonLat;
}

export const COUNTRY_PROXIES: readonly CountryProxy[] = [
  { country: 'Japan', proxy: 'EWJ', at: [139.69, 35.69] },
  { country: 'Hong Kong', proxy: 'EWH', at: [114.17, 22.28] },
  { country: 'China', proxy: 'FXI', at: [121.47, 31.23] },
  { country: 'Taiwan', proxy: 'EWT', at: [121.56, 25.03] },
  { country: 'Korea', proxy: 'EWY', at: [126.98, 37.57] },
  { country: 'India', proxy: 'INDA', at: [72.88, 19.08] },
  { country: 'Singapore', proxy: 'EWS', at: [103.82, 1.35] },
  { country: 'Australia', proxy: 'EWA', at: [151.21, -33.87] },
  { country: 'New Zealand', proxy: 'ENZL', at: [174.78, -41.29] },
  { country: 'Germany', proxy: 'EWG', at: [8.68, 50.11] },
  { country: 'United Kingdom', proxy: 'EWU', at: [-0.13, 51.51] },
  { country: 'France', proxy: 'EWQ', at: [2.35, 48.86] },
  { country: 'Spain', proxy: 'EWP', at: [-3.7, 40.42] },
  { country: 'Italy', proxy: 'EWI', at: [9.19, 45.46] },
  { country: 'Switzerland', proxy: 'EWL', at: [8.54, 47.38] },
  { country: 'Netherlands', proxy: 'EWN', at: [4.9, 52.37] },
];

export interface Move extends CountryProxy {
  changePct: number;
}

/** How many arcs the globe draws. */
export const ARC_COUNT = 3;

/** The largest moves by size, either way, largest first; markets without a change are left out. */
export function biggestMoves(
  changes: Readonly<Record<string, number | undefined>>,
  count = ARC_COUNT,
): Move[] {
  return COUNTRY_PROXIES.flatMap((country) => {
    const changePct = changes[country.proxy];
    return changePct === undefined || !Number.isFinite(changePct)
      ? []
      : [{ ...country, changePct }];
  })
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, count);
}

/** Views the panel can turn to: a longitude and latitude at the centre of the disc. */
export const VIEWS: readonly { id: string; label: string; centre: LonLat }[] = [
  { id: 'americas', label: 'Americas', centre: [-80, 25] },
  { id: 'europe', label: 'Europe', centre: [15, 35] },
  { id: 'asia', label: 'Asia-Pacific', centre: [120, 15] },
];

/**
 * The view to open on: the one whose exchanges are open now, the latest to open first (the
 * trading day moves west), else the viewer's own side of the world.
 */
export function openingView(
  openSessions: ReadonlySet<string>,
  viewerOffsetMinutes: number,
): LonLat {
  if (openSessions.has('new-york')) return VIEWS[0]?.centre ?? [0, 0];
  if (openSessions.has('london') || openSessions.has('frankfurt'))
    return VIEWS[1]?.centre ?? [0, 0];
  if (openSessions.size > 0) return VIEWS[2]?.centre ?? [0, 0];
  return [wrap180((viewerOffsetMinutes / 60) * 15), 25];
}

/** Turning the globe: a drag of `dx`, `dy` pixels on a disc of `radius` px. */
export function dragged(centre: LonLat, dx: number, dy: number, radius: number): LonLat {
  const degreesPerPixel = 90 / Math.max(radius, 1);
  const lat = Math.max(-80, Math.min(80, centre[1] + dy * degreesPerPixel));
  return [wrap180(centre[0] - dx * degreesPerPixel), lat];
}
