'use client';

import { NEWS, NEWS_LATEST, unseenNews, type NewsItem } from '@ironvow/config';

/**
 * What's new.
 *
 * The game changed every few days and nobody playing it was told. Somebody who
 * left before the air layer came back to a building they had never seen, in a
 * list they had already learned, and nothing anywhere said what it was for.
 *
 * Two ways in, and the difference matters. Unread notes are shown once, on
 * their own, the moment the base loads — that is the returning player. The
 * whole run is also reachable from settings at any time, because a panel that
 * can only ever be seen once is a panel that gets dismissed by accident.
 */
export interface NewsSheetProps {
  /** The last note this player has read. Everything above it is new to them. */
  seen: number;
  /** False when opened from settings: then the whole run is shown, read or not. */
  onlyUnread: boolean;
  onClose: () => void;
}

export function NewsSheet({ seen, onlyUnread, onClose }: NewsSheetProps) {
  const items: readonly NewsItem[] = onlyUnread ? unseenNews(seen) : NEWS;

  return (
    <div className="sheet" id="newsSheet">
      <div className="sheetHead">
        <div>
          <h2>WHAT&rsquo;S NEW</h2>
          <p>
            {onlyUnread
              ? `${items.length} ${items.length === 1 ? 'change' : 'changes'} since you were last here.`
              : 'Everything that has changed, newest first.'}
          </p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {items.map((n) => (
        <section className="newsItem" key={n.no}>
          <h3>{n.title.toUpperCase()}</h3>
          <span className="when">{n.at}</span>
          <ul>
            {n.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      ))}

      <button className="btn gold big" onClick={onClose}>
        {onlyUnread ? 'GOT IT' : 'CLOSE'}
      </button>
    </div>
  );
}

/** Whether there is anything to show this player at all. */
export function hasNews(seen: number): boolean {
  return seen < NEWS_LATEST;
}
