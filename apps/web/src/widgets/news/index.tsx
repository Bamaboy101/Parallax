import type { IDockviewPanelProps } from 'dockview-react';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import { useNews, newsTarget } from '../../store/news';

interface NewsParams {
  query?: string;
}

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(published: number, now: number): string {
  if (published === 0) return '';
  const today = new Date(now).toDateString() === new Date(published).toDateString();
  return today ? time.format(published) : date.format(published);
}

/** Headlines from publisher RSS (via the edge) and, for a stock, the user's own company news. */
export default function News({ params }: IDockviewPanelProps<NewsParams>) {
  const query = params.query?.trim() ?? '';
  const news = useNews(query);
  const { stock } = newsTarget(query);
  const failed = news.feeds.filter((feed) => !feed.ok).map((feed) => feed.name);
  const now = news.loadedAt;

  return (
    <div className="news-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">{query === '' ? 'All headlines' : `“${query}”`}</span>
        {stock && <span className="panel-caption">{stock.name}</span>}
      </div>
      {news.state === 'loading' && <p className="panel-empty">Loading headlines…</p>}
      {news.failure && (
        <PanelNotice
          notice={failureNotice(news.failure, 'Headlines')}
          compact={news.items.length > 0}
        />
      )}
      {news.state === 'ready' && news.items.length === 0 && (
        <p className="panel-empty">
          {query === '' ? 'No headlines right now.' : `No recent headlines match “${query}”.`}
        </p>
      )}
      {news.items.length > 0 && (
        <ol className="news-list">
          {news.items.map((item) => (
            <li key={item.url} className="news-item">
              <div className="news-meta">
                <time dateTime={new Date(item.published).toISOString()}>
                  {when(item.published, now)}
                </time>
                <span>{item.source}</span>
              </div>
              <a href={item.url} target="_blank" rel="noreferrer noopener" className="news-title">
                {item.title}
              </a>
              {item.summary && <p className="news-summary">{item.summary}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="panel-footnote">
        Publisher RSS via the edge, refreshed every 2 min
        {news.companySource ? ` · company news from ${news.companySource} on your key` : ''}
        {failed.length > 0 ? ` · not answering: ${failed.join(', ')}` : ''}
      </p>
    </div>
  );
}
