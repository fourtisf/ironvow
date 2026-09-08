'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmt } from '../lib/format';
import { api, type SharedReplay } from '../lib/api';
import { GameCanvas } from './GameCanvas';
import { StarIcon, GoldIcon, IronIcon } from './icons';
import { beginBattle, type World } from '../lib/game/world';

/**
 * Watching somebody else's raid, without an account.
 *
 * The whole fight is already stored — seed, frozen base, army, every deploy —
 * and the same simulation runs here that ran on the server, so this page is not
 * a video of a raid. It is the raid, played again from its inputs, on the
 * viewer's own machine.
 *
 * Nothing on this page asks who is watching. No sign-in, no access code, no
 * cookie needed: a link that opens a form is a link nobody clicks twice.
 */
export function WatchReplay({ shareId }: { shareId: string }) {
  const worldRef = useRef<World | null>(null);
  const [replay, setReplay] = useState<SharedReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // The overlay reads the battle every frame; the world is not React state.
  const [, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.sharedReplay(shareId)
      .then((r) => { if (live) setReplay(r); })
      .catch(() => { if (live) setError('That replay is not here any more.'); });
    return () => { live = false; };
  }, [shareId]);

  /*
   * Start once both halves exist, in whichever order they arrive: the canvas
   * hands over its world on mount, and the fetch lands whenever it lands.
   */
  const start = useCallback((world: World, r: SharedReplay) => {
    beginBattle(world, {
      raidId: '', seed: r.seed, snapshot: r.snapshot, army: r.army,
      hero: r.hero, troopLevels: r.troopLevels, pouch: r.pouch,
      expiresAt: new Date().toISOString(), rerollCost: 0,
    }, 'raid', { commands: r.commands, items: r.items });
    // Twice over by default. A raid runs three minutes and a link asks for a
    // stranger's attention, not their afternoon.
    world.battleSpeed = 2;
  }, []);

  useEffect(() => {
    if (replay && worldRef.current) start(worldRef.current, replay);
  }, [replay, start]);

  /* --- the overlay's clock, separate from the battle's --- */
  useEffect(() => {
    let raf = 0;
    const pump = (): void => { setTick((n) => n + 1); raf = requestAnimationFrame(pump); };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, []);

  const battle = worldRef.current?.battle ?? null;
  const stars = battle ? battle.stars() : (replay?.stars ?? 0);
  // A fraction everywhere it is stored and computed, a percentage only where a
  // person reads it — which is here, and was 1% for a three-star wipe until it
  // was multiplied.
  const pct = Math.round((battle ? battle.destroyedPct() : (replay?.destroyedPct ?? 0)) * 100);

  const noop = (): void => undefined;

  return (
    <div id="watch">
      <GameCanvas
        events={{
          onSelect: noop, onModeChange: noop, onToast: noop, onPlayerChanged: noop,
          onBattleEnd: () => setEnded(true),
          onPlacementChanged: noop, onPlacementCommit: noop, onCameraMoved: noop,
        }}
        onReady={(w) => {
          worldRef.current = w;
          if (replay) start(w, replay);
        }}
        onTapBuilding={noop}
      />

      <div id="watchTop">
        <span className="who">{replay?.attacker ?? '…'}</span>
        <span className="vs">attacked</span>
        <span className="who">{replay?.defender ?? '…'}</span>
      </div>

      <div id="watchBar">
        <div className="stars">
          {[0, 1, 2].map((i) => <StarIcon key={i} on={i < stars} />)}
        </div>
        <div className="pct">{pct}%</div>
        {replay && (replay.loot.g > 0 || replay.loot.i > 0) && (
          <div className="took">
            <span><GoldIcon />{fmt(replay.loot.g)}</span>
            <span><IronIcon />{fmt(replay.loot.i)}</span>
          </div>
        )}
      </div>

      {error !== null && (
        <div className="watchCard">
          <h2>NOTHING HERE</h2>
          <p>{error}</p>
          <a className="btn gold big" href="/">PLAY IRONVOW</a>
        </div>
      )}

      {ended && error === null && (
        <div className="watchCard">
          <h2>{stars >= 1 ? 'BASE TAKEN' : 'DRIVEN OFF'}</h2>
          <p>
            {replay?.attacker} took {stars} {stars === 1 ? 'star' : 'stars'} off{' '}
            {replay?.defender}&rsquo;s base, and {pct}% of it.
          </p>
          <p className="sub">
            Build a base of your own, and find out whether anybody can do that to it.
          </p>
          <a className="btn gold big" href="/">PLAY IRONVOW</a>
        </div>
      )}
    </div>
  );
}
