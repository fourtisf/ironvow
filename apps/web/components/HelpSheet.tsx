'use client';

/**
 * How to play. The rules in one place, in the order a new player meets them.
 * Nothing here is a number the server does not also enforce.
 */
export interface HelpSheetProps {
  onClose: () => void;
  onReplayTutorial: () => void;
}

const SECTIONS: { h: string; lines: string[] }[] = [
  {
    h: 'Your hold',
    lines: [
      'Everything lives on the server. Your buildings produce, your troops train and raids resolve whether or not the game is open.',
      'The Keep is the heart of the hold. Its level caps every other building and unlocks new ones. Raise it first when you are stuck.',
      'Tap a building to select it. Drag a selected building to move it. Press and hold any building to pick it up straight away.',
    ],
  },
  {
    h: 'Gold and iron',
    lines: [
      'Gold Mines make gold and Iron Forges make iron, around the clock. They hold what they make until you collect: tap the pouch, or COLLECT.',
      'Vaults raise how much you can hold. Anything above the cap is lost, so build a Vault before you claim a big reward.',
      'Raiders take a share of the gold and iron sitting in your Vaults and producers. What you have collected and spent cannot be stolen.',
    ],
  },
  {
    h: 'Building',
    lines: [
      'Open BUILD, pick a building, drop it on free ground and press PLACE. Each Keep level allows more of each kind.',
      'You have three builders. Every build or upgrade takes one for its duration; FINISH pays gold to skip the wait.',
      'Cancelling a job costs nothing. Demolishing a building frees its slot; the gold spent on it is gone.',
    ],
  },
  {
    h: 'Defending',
    lines: [
      'Cannons fire slow, heavy shots at anything in range. Arrow Towers fire fast and far and melt light troops.',
      'Ramparts block the path. Attackers must stop and break them, ideally inside a cannon’s range.',
      'After you are raided you get a shield for a while, during which nobody can hit you. Raiding out drops it.',
    ],
  },
  {
    h: 'Your army',
    lines: [
      'Barracks train troops and unlock new ones. Muster Fields are the ground the warband stands on and set how many you can hold — build more of them, and upgrade them, for a bigger army.',
      'Raiders are cheap and fast. Lancers hit hard. Archers stay back and shoot over walls. Rams go for ramparts. Scalers climb them.',
      'The War Lab raises a troop type’s level for good. Your hero can be sent in once per raid and rests afterwards.',
    ],
  },
  {
    h: 'Raiding',
    lines: [
      'Press RAID to be shown a hold. Look it over, then ATTACK or pay a little gold to see another.',
      'Tap the ground to drop the selected troop. Troops choose their own targets from where they land; you cannot steer them after.',
      'One star for breaking half the hold, one for the Keep, one for all of it. One star or more is a win.',
      'A win takes trophies from the defender and loot from what they had lying around. A loss costs you some trophies.',
    ],
  },
  {
    h: 'Orders',
    lines: [
      'War Orders are one-time goals in order, and the fastest way to grow. The guide points at the next one.',
      'Every day brings three new orders at midnight UTC. Each day you finish one, your streak grows and so do the rewards.',
      'Rewards go straight into your stores. Claim them when there is room.',
    ],
  },
  {
    h: 'Clans',
    lines: [
      'Found or join a clan in CLAN. Chat with the members and climb the clan ladder together.',
    ],
  },
];

export function HelpSheet({ onClose, onReplayTutorial }: HelpSheetProps) {
  return (
    <div className="sheet" id="helpSheet">
      <div className="sheetHead">
        <div>
          <h2>HOW TO PLAY</h2>
          <p>The rules of the hold, in the order you meet them.</p>
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
