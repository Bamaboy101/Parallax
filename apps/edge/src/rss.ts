/** One headline from a publisher's feed. */
export interface Headline {
  title: string;
  url: string;
  source: string;
  /** Epoch ms; 0 when the feed gives no date. */
  published: number;
  /** Plain-text summary, at most 280 characters. */
  summary: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (/^#x/i.test(name)) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/** Text content: CDATA and entities decoded, markup stripped, whitespace collapsed. */
function plain(text: string): string {
  return decode(decode(text).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1];
}

/**
 * Items from an RSS 2.0 document (every feed in NEWS_FEEDS is RSS 2.0). Items without a title
 * or an http(s) link are skipped, never thrown.
 */
export function parseFeed(xml: string, source: string): Headline[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].flatMap(([block]): Headline[] => {
    const title = plain(tag(block, 'title') ?? '');
    const url = plain(tag(block, 'link') ?? '');
    if (!title || !/^https?:\/\//.test(url)) return [];
    const date = tag(block, 'pubDate') ?? tag(block, 'dc:date');
    const published = date ? Date.parse(plain(date)) : Number.NaN;
    const summary = plain(tag(block, 'description') ?? '');
    return [
      {
        title,
        url,
        source,
        published: Number.isNaN(published) ? 0 : published,
        summary: summary.length > 280 ? `${summary.slice(0, 279)}…` : summary,
      },
    ];
  });
}
