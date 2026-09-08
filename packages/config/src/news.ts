/**
 * What changed, in the game's own words.
 *
 * The game has been changing every few days and nobody playing it was told. A
 * player who left before the air layer came back to a building they had never
 * seen, in a list they had already learned, with no way to find out what it was
 * for. That is not a missing feature so much as a missing sentence.
 *
 * Notes live here rather than in a table because they are content, not state:
 * they ship with the build that introduced them, they are the same for every
 * player, and a note that can be edited after the fact is a note that can
 * disagree with the game it describes.
 *
 * Same rule as everything else the player reads — see PLAIN_WORDS in
 * `buildings.ts`. If a note needs a glossary it is written wrong.
 */

export interface NewsItem {
  /**
   * Position in the run, and the whole of the ordering.
   *
   * A number rather than the date because two notes can land on one day, and
   * rather than the array index because the index of a note changes every time
   * an older one is added above it — and the index is what players have stored
   * as "the last one I read".
   */
  no: number;
  /** YYYY-MM-DD, for display only. */
  at: string;
  title: string;
  /** One thought each. A note nobody finishes reading is a note nobody read. */
  lines: string[];
}

/** Newest first, which is also the order they are shown in. */
export const NEWS: readonly NewsItem[] = [
  {
    no: 7,
    at: '2026-09-08',
    title: 'Attack from the air',
    lines: [
      'The Bomber flies. Walls do not stop it, traps do not catch it, and it goes straight for whatever it wants. Barracks level 5.',
      'Air Defence shoots flyers and nothing else. It is the strongest gun in the game against them and completely useless against anything on foot.',
      'Of everything you can already build, only the Archer Tower and the Archer can shoot upward. A base with no Air Defence has almost no answer.',
    ],
  },
  {
    no: 6,
    at: '2026-09-08',
    title: 'Plainer words',
    lines: [
      'A lot of things were renamed. Your Hold is a Town Hall, your Vow is your Army Camps, a Rampart is a Wall.',
      'Nothing changed about how any of it works. The names were just harder than the game.',
    ],
  },
  {
    no: 5,
    at: '2026-09-08',
    title: 'Look anyone up',
    lines: [
      'Search for a player by name and look at their base, their trophies and their clan.',
      'You now get four layout slots instead of two, so a base you liked is never more than a tap away.',
    ],
  },
  {
    no: 4,
    at: '2026-09-08',
    title: 'Something after the last upgrade',
    lines: [
      'Relics: Guard, Blade and Revive. They make your Vowkeeper tougher, stronger, or quicker to come back after it falls.',
      'You can carry two at a time, and swap them whenever you like.',
      'They level up with shards, which come from clan wars and from the end of a season. Nothing you can buy.',
    ],
  },
  {
    no: 3,
    at: '2026-09-08',
    title: 'Why your base fell',
    lines: [
      'When someone beats you, you now get told how: where they came in, what fell first, and which of your guns never fired a shot.',
      'It also tells you when your traps went off, and when they came by air and you had nothing to shoot back with.',
    ],
  },
  {
    no: 2,
    at: '2026-09-08',
    title: 'Traps, and a gun that punishes crowds',
    lines: [
      'Spike Trap and Net Trap are hidden. An attacker scouting your base cannot see them, and only finds out by walking over one.',
      'The Mortar drops a shell into the thickest part of a crowd. It cannot hit anything standing close to it, so where you put it decides whether it is worth having.',
    ],
  },
  {
    no: 1,
    at: '2026-09-07',
    title: 'Seasons, two things to spend mid-raid, and clan troops',
    lines: [
      'Trophies now run in seasons. When one ends you are paid for the highest you reached, and everyone starts again closer together.',
      'Rage Horn and Bomb are spent during a raid, not before it. A raid you were losing is now a raid you can still turn.',
      'Ask your clan for troops and they can fill your camps. Whatever they send defends your base while you are away.',
    ],
  },
] as const;

/** The newest note. A player who has seen this has seen everything. */
export const NEWS_LATEST: number = NEWS.reduce((a, n) => (n.no > a ? n.no : a), 0);

/** Everything published since the note the player last read, newest first. */
export function unseenNews(seen: number): NewsItem[] {
  return NEWS.filter((n) => n.no > seen);
}
