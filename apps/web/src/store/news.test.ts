import { describe, expect, it } from 'vitest';
import type { NewsItem } from '../feeds/types';
import { mergeNews, newsTarget } from './news';

const item = (title: string, url: string, published: number): NewsItem => ({
  title,
  url,
  source: 'Test',
  published,
  summary: '',
});

describe('newsTarget', () => {
  it('turns a catalogue ticker into a company-name search plus that stock', () => {
    expect(newsTarget('aapl')).toMatchObject({ rss: 'Apple', stock: { id: 'AAPL' } });
    expect(newsTarget('JPM')).toMatchObject({ rss: 'JPMorgan', stock: { id: 'JPM' } });
  });

  it('passes other queries through, including crypto and free text', () => {
    expect(newsTarget('  rate cut ')).toEqual({ rss: 'rate cut', stock: undefined });
    expect(newsTarget('BTC-USD')).toEqual({ rss: 'BTC-USD', stock: undefined });
  });
});

describe('mergeNews', () => {
  it('orders newest first and drops repeats by link or by headline', () => {
    const merged = mergeNews(
      [item('Fed holds', 'https://a/1', 10), item('Oil slips', 'https://a/2', 30)],
      [item('fed holds ', 'https://b/9', 20), item('Gold up', 'https://a/1', 40)],
    );
    expect(merged.map((news) => news.title)).toEqual(['Gold up', 'Oil slips', 'fed holds ']);
  });
});
