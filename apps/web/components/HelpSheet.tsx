'use client';

/**
 * How to play. The rules in one place, in the order a new player meets them.
 * Nothing here is a number the server does not also enforce.
 */
export interface HelpSheetProps {
  onClose: () => void;
  onReplayTutorial: () => void;
}

/** Exported so `plain-words.test.ts` can sweep it: this is text players read. */
export const SECTIONS: { h: string; lines: string[] }[] = [
  {
    h: 'Your base',
    lines: [
      'Everything lives on the server. Your buildings produce, your troops train and raids resolve whether or not the game is open.',
      'The Town Hall is the heart of your base. Its level limits every other building and unlocks new ones. Upgrade it first when you are stuck.',
      'Tap a building to select it. Drag a selected building to move it. Press and hold any building to pick it up straight away.',
    ],
  },
  {
    h: 'Gold and iron',
    lines: [
      'Gold Mines make gold and Iron Forges make iron, around the clock. They store it until you collect: tap the coins, or press COLLECT.',
      'Storages raise how much you can keep. Anything above the limit is lost, so build a Storage before you claim a big reward.',
      'Attackers take a share of the gold and iron sitting in your Storages and collectors. What you have already spent cannot be stolen.',
    ],
  },
  {
    h: 'Building',
    lines: [
      'Open BUILD, pick a building, drop it on free ground and press PLACE. Each Town Hall level allows more of each kind.',
      'You have three builders. Every build or upgrade takes one for its duration; FINISH pays gold to skip the wait.',
      'Cancelling a job costs nothing. Selling a building frees its slot and gives back half of what you spent.',
    ],
  },
  {
    h: 'Defending',
    lines: [
      'Cannons fire slow, heavy shots at anything on foot. Archer Towers fire fast and far, and are one of only two things you can build that shoot upward.',
      'The Mortar drops a shell into the thickest part of a crowd, and cannot hit anything standing close to it. Air Defence shoots flyers and nothing else.',
      'Walls block the path. Attackers must stop and break them, ideally inside a cannon’s range.',
      'Spike Traps and Net Traps are hidden. Somebody scouting your base cannot see them, and finds out by walking over one.',
      'After you are raided you get a shield for a while, during which nobody can hit you. Raiding out drops it.',
    ],
  },
  {
    h: 'Your army',
    lines: [
      'Barracks train troops and unlock new ones. Army Camps set how many troops you can have — build more of them, and upgrade them, for a bigger army.',
      'Raiders are cheap and fast. Lancers hit hard. Archers stay back and shoot over walls. Rams go for walls. Climbers climb over them.',
      'The Bomber flies. Walls do not stop it and traps do not catch it, but Air Defence tears it apart.',
      'The Laboratory upgrades a troop type for good. Your hero can be sent in once per raid and rests afterwards.',
    ],
  },
  {
    h: 'Raiding',
    lines: [
      'Press RAID to be shown a base. Look it over, then ATTACK or pay a little gold to see another.',
      'Tap the ground to drop the selected troop. Troops choose their own targets from where they land; you cannot steer them after.',
      'One star for destroying half the base, one for the Town Hall, one for all of it. One star or more is a win.',
      'A win takes trophies from the defender and loot from what they had lying around. A loss costs you some trophies.',
    ],
  },
  {
    h: 'Quests',
    lines: [
      'Quests are one-time goals in order, and the fastest way to grow. The guide points at the next one.',
      'Every day brings three new daily quests at midnight UTC. Each day you finish one, your streak grows and so do the rewards.',
      'Rewards go straight into your stores. Claim them when there is room.',
    ],
  },
  {
    h: 'Clans',
    lines: [
      'Start or join a clan in CLAN. Chat with the members and climb the clan leaderboard together.',
      'Ask your clan for troops and they can fill your camps. Whatever they send defends your base while you are away.',
      'Clan wars pay relic shards, which is most of where relics come from.',
    ],
  },
  {
    h: 'Seasons',
    lines: [
      'Trophies run in seasons. When one ends you are paid for the highest you reached that season, not the number you finish on — so a peak counts even if you slide back.',
      'Everyone then starts again closer together, and the ladder is worth climbing a second time.',
    ],
  },
  {
    h: 'Items and relics',
    lines: [
      'The Rage Horn and the Bomb are spent during a raid rather than before it. A raid you were losing is a raid you can still turn.',
      'Relics — Guard, Blade and Revive — make your hero tougher, stronger, or quicker to come back. You carry two at a time and can swap them whenever you like.',
      'Relics level up with shards, from clan wars and the end of a season. There is nothing in this game you can buy.',
    ],
  },
];

export function HelpSheet({ onClose, onReplayTutorial }: HelpSheetProps) {
  return (
    <div className="sheet" id="helpSheet">
      <div className="sheetHead">
        <div>
          <h2>HOW TO PLAY</h2>
          <p>The rules of the game, in the order you meet them.</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {SECTIONS.map((s) => (
        <section className="helpSec" key={s.h}>
          <h3>{s.h.toUpperCase()}</h3>
          <ul>
            {s.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      ))}

      <button className="btn grey big" onClick={onReplayTutorial}>REPLAY THE TUTORIAL</button>
    </div>
  );
}
