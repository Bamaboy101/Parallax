import { useEffect, useState } from 'react';
import type { NewsItem } from '../feeds/types';
import { edgeJson } from './edge';
import { requestNews } from './feedClient';
import { instrument, type Instrument } from './symbols';

/** The edge caches news for 2 minutes; refreshing faster only re-reads its cache. */
export const NEWS_REFRESH_MS = 120_000;
const COMPANY_NEWS_DAYS = 3;
const NEWS_LIMIT = 100;

export interface NewsState {
  state: 'loading' | 'ready' | 'error';
  items: NewsItem[];
  /** Publisher feeds behind the edge and whether each answered. */
  feeds: { name: string; ok: boolean }[];
  /** The feed that supplied company news for a stock query, e.g. 'finnhub'. */
  companySource: string | undefined;
  error: string | undefined;
  /** When this answer arrived, so "today" is judged against it, not render time. */
  loadedAt: number;
}

/**
 * A query that names a stock in the catalogue (by ticker) searches publisher RSS by company name,
 * since headlines rarely carry tickers, and adds the feed's company news for that ticker.
 */
export function newsTarget(query: string): { rss: string; stock: Instrument | undefined } {
  const trimmed = query.trim();
  const stock = instrument(trimmed.toUpperCase());
  if (stock?.kind !== 'equity') return { rss: trimmed, stock: undefined };
  return { rss: stock.name.split(' ')[0] ?? stock.id, stock };
}

/** Newest first, one entry per link or headline, at most 100. */
export function mergeNews(...lists: readonly NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .sort((a, b) => b.published - a.published)
    .filter((item) => {
      const keys = [item.url, item.title.trim().toLowerCase()];
      if (keys.some((key) => seen.has(key))) return false;
      for (const key of keys) seen.add(key);
      return true;
    })
    .slice(0, NEWS_LIMIT);
}

function isEdgeNews(value: unknown): value is { items: NewsItem[]; sources: NewsState['feeds'] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray(value.items) &&
    'sources' in value &&
    Array.isArray(value.sources)
  );
}

const INITIAL: NewsState = {
  state: 'loading',
  items: [],
  feeds: [],
  companySource: undefined,
  error: undefined,
  loadedAt: 0,
};

/** Headlines for a query (empty: everything), refreshed every 2 minutes. */
export function useNews(query: string): NewsState {
  // Each answer remembers its query, so a new query reads as loading until its own answer lands.
  const [news, setNews] = useState<NewsState & { query: string }>({ ...INITIAL, query });

  useEffect(() => {
    let cancelled = false;
    const { rss, stock } = newsTarget(query);
    const load = async () => {
      const now = Date.now();
      const [edge, company] = await Promise.allSettled([
        edgeJson(`/news${rss ? `?q=${encodeURIComponent(rss)}` : ''}`),
        stock
          ? requestNews(stock, now - COMPANY_NEWS_DAYS * 86_400_000, now)
          : Promise.reject(new Error('not a stock')),
      ]);
      if (cancelled) return;
      const edgeNews =
        edge.status === 'fulfilled' && isEdgeNews(edge.value) ? edge.value : undefined;
      const companyNews = company.status === 'fulfilled' ? company.value : undefined;
      if (!edgeNews && !companyNews) {
        const reason = edge.status === 'rejected' ? (edge.reason as unknown) : undefined;
        setNews({
          ...INITIAL,
          query,
          state: 'error',
          error: reason instanceof Error ? reason.message : 'news unavailable',
        });
        return;
      }
      setNews({
        query,
        state: 'ready',
        items: mergeNews(edgeNews?.items ?? [], companyNews?.items ?? []),
        feeds: edgeNews?.sources ?? [],
        companySource: companyNews?.source,
        error: undefined,
        loadedAt: now,
      });
    };
    void load();
    const timer = window.setInterval(() => void load(), NEWS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [query]);

  return news.query === query ? news : INITIAL;
}
