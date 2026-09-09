'use client';

import { TELEGRAM_URL, X_URL } from '../lib/links';
import { TelegramIcon, XIcon } from './icons';

/**
 * Where to find the project.
 *
 * One component, used everywhere the links appear, because the alternative is
 * three copies that disagree about whether an unset address is a dead link or a
 * chip saying SOON — and the one that guesses wrong is the one a stranger sees.
 *
 * The addresses are read from the environment and never written here: the
 * accounts belong to whoever runs the server, not to the code. See `links.ts`.
 */
export function SocialRow({ soon = true }: {
  /**
   * Whether an address that is not configured is drawn at all.
   *
   * True on the first screen, where a place marked SOON says more than an empty
   * row and an unfinished-looking card reads as a deploy that did not land.
   * False everywhere else, where a dimmed chip promising something is noise.
   */
  soon?: boolean;
}) {
  const chip = (url: string, label: string, icon: React.ReactNode) => {
    if (url !== '') {
      return (
        <a
          className="sbtn"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`The project on ${label}`}
        >
          {icon}
        </a>
      );
    }
    return soon
      ? <span className="sbtn soon" aria-label={`${label}: coming soon`}>{icon}<em>SOON</em></span>
      : null;
  };

  const x = chip(X_URL, 'X', <XIcon />);
  const tg = chip(TELEGRAM_URL, 'Telegram', <TelegramIcon />);
  // Nothing configured and nothing to promise: draw no row at all rather than
  // an empty box with a border round it.
  if (x === null && tg === null) return null;

  return <div className="social">{x}{tg}</div>;
}
