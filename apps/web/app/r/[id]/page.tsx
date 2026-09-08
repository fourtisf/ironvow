import type { Metadata } from 'next';
import { WatchReplay } from '../../../components/WatchReplay';

/**
 * A raid anybody can watch.
 *
 * Deliberately not the game. `Game` is what holds the access code, the session
 * and the whole HUD; this route renders none of it, so a share link opens a
 * fight rather than a door. That separation is the feature, not a shortcut.
 */

interface Props {
  params: { id: string };
}

interface Card {
  attacker: string;
  defender: string;
  stars: number;
  destroyedPct: number;
}

/**
 * The headline, fetched on the server so a pasted link unfurls into the fight
 * rather than into the game's generic card.
 *
 * `API_PROXY_URL` and not `NEXT_PUBLIC_API_URL`: the public one is `/api`, a
 * path the browser resolves against the page it is on, and there is no page to
 * resolve against here. This runs inside the container and needs the address
 * the container can reach. Both are declared in `turbo.json`, without which
 * strict env mode drops them on the way to the build.
 */
async function cardFor(id: string): Promise<Card | null> {
  const base = process.env.API_PROXY_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/share/${encodeURIComponent(id)}/card`, {
      // A shared fight never changes, but it can be withdrawn, so a short life
      // rather than forever.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Card;
  } catch {
    // A preview is worth having and never worth failing a page for.
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await cardFor(params.id);
  if (!card) return { title: 'A raid on IRONVOW' };

  const title = card.stars > 0
    ? `${card.attacker} took ${card.stars} ${card.stars === 1 ? 'star' : 'stars'} off ${card.defender}`
    : `${card.defender} held off ${card.attacker}`;
  // Stored as a fraction, read by a person as a percentage.
  const description = `${Math.round(card.destroyedPct * 100)}% of the base destroyed. `
    + 'Watch the whole raid — no account needed.';

  return {
    title,
    description,
    openGraph: {
      title, description, siteName: 'IRONVOW', type: 'article',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

export default function Page({ params }: Props) {
  return <WatchReplay shareId={params.id} />;
}
