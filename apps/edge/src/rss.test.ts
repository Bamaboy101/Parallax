import { describe, expect, it } from 'vitest';
import bbc from './fixtures/bbc.xml?raw';
import cnbc from './fixtures/cnbc.xml?raw';
import fed from './fixtures/fed.xml?raw';
import { parseFeed } from './rss';

// Fixtures: the first three items of each feed, recorded 16 Nov 2026.
describe('parseFeed', () => {
  it.each([
    ['CNBC', cnbc],
    ['BBC Business', bbc],
    ['Federal Reserve', fed],
  ])('reads %s headlines as plain text with links and dates', (source, xml) => {
    const items = parseFeed(xml, source);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.source).toBe(source);
      expect(item.title).not.toMatch(/<|&[a-z]+;|CDATA/);
      expect(item.summary).not.toMatch(/<|CDATA/);
      expect(item.url).toMatch(/^https:\/\//);
      expect(item.published).toBeGreaterThan(Date.parse('2026-01-01'));
    }
  });

  it('decodes entities, strips markup (including entity-encoded HTML) and skips bad links', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Rates &amp; <b>bonds</b>]]></title><link>https://example.com/a</link>
        <description>&lt;p&gt;Yields &#8217;rise&#x2019; sharply&lt;/p&gt;</description></item>
      <item><title>No link</title></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item>
    </channel></rss>`;
    expect(parseFeed(xml, 'Test')).toEqual([
      {
        title: 'Rates & bonds',
        url: 'https://example.com/a',
        source: 'Test',
        published: 0,
        summary: 'Yields ’rise’ sharply',
      },
    ]);
  });
});
