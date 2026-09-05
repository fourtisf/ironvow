'use client';

import { PROD, TYPES, hasClaimableQuest, type BuildingType, type TroopType } from '@ironvow/config';
import type { DeployCommand } from '@ironvow/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import {
  beginBattle,
  bump,
  cancelPlacement,
  centerOnKeep,
  clearPreview,
  popup,
  setMode,
  showPreview,
  startPlacement,
  type World,
} from '../lib/game/world';
import type { BattleOutcome, Mode, PlayerState, ScoutedRaid } from '../lib/game/types';
import { fmt } from '../lib/format';
import { loadSoundPreference, setSoundEnabled, sfx, unlockAudio } from '../lib/sfx';
import { BattleHud } from './BattleHud';
import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';
import { Inspector, PlaceBar } from './Inspector';
import { ClaimModal, ResultModal, ScoutModal, SignInModal } from './Modals';
import { QuestSheet, rewardText, type QuestRow } from './QuestSheet';
import { ArmySheet, BuildSheet, LogSheet } from './Sheets';
import { Toast } from './Toast';

/**
 * The shell.
 *
 * React owns the HUD, the sheets and the modals. The field owns itself — the
 * canvas is driven by requestAnimationFrame against a mutable world in a ref,
 * and the only traffic between them is this component pushing the latest
 * server state down and the world calling back when the player does something.
 */

type Sheet = 'build' | 'army' | 'orders' | 'log' | null;

export function Game() {
  const worldRef = useRef<World | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mode, setModeState] = useState<Mode>('base');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scout, setScout] = useState<ScoutedRaid | null>(null);
  const [outcome, setOutcome] = useState<(BattleOutcome & { pending: boolean }) | null>(null);
  const [incoming, setIncoming] = useState<Awaited<ReturnType<typeof api.incoming>>['raids']>([]);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInSent, setSignInSent] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [claimingQuest, setClaimingQuest] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimSent, setClaimSent] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [guestNoteDismissed, setGuestNoteDismissed] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  /** Bumped once a frame while a battle runs, so the battle HUD tracks it. */
  const [battleTick, setBattleTick] = useState(0);

  /* --- toasts are the game's only error channel, as in the prototype --- */
  const say = useCallback((message: string) => setToast(message + '​'.repeat(Math.random() * 3 | 0)), []);

  /** Frame the hold once, on the first load, not on every poll. */
  const framed = useRef(false);

  const applyPlayer = useCallback((next: PlayerState) => {
    setPlayer(next);
    const world = worldRef.current;
    if (world) {
      // Preserve the local bump animation across a server refresh, so a
      // building that was just placed does not stop mid-pop.
      const bumps = new Map(world.player?.buildings.map((b) => [b.id, b.bump]) ?? []);
      world.player = { ...next, buildings: next.buildings.map((b) => ({ ...b, bump: bumps.get(b.id) })) };

      // The canvas mounts before /me answers, so the first frame has nothing to
      // frame against. Do it once the hold actually arrives.
      if (!framed.current && next.buildings.length > 0 && world.mode === 'base') {
        framed.current = true;
        centerOnKeep(world);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyPlayer(await api.me());
      setSignedIn(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedIn(false);
      else say('Could not reach the server');
    }
  }, [applyPlayer, say]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setSoundOn(loadSoundPreference());
    try {
      setGuestNoteDismissed(localStorage.getItem('ironvow_guest_note') === 'off');
    } catch {
      // Private browsing refuses storage; the note simply reappears next visit.
    }
  }, []);

  const loadQuests = useCallback(async () => {
    try {
      setQuests((await api.quests()).quests);
    } catch {
      // The orders sheet is not worth a toast; the rail dot just stays quiet.
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void api.incoming().then((r) => setIncoming(r.raids)).catch(() => undefined);
    void loadQuests();
    // The server settles production lazily, so a periodic re-read is what keeps
    // the HUD honest without a socket.
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [signedIn, refresh, loadQuests]);

  /* --- keep the battle HUD ticking while a raid runs --- */
  useEffect(() => {
    if (mode !== 'battle') return;
    let raf = 0;
    const pump = (): void => {
      setBattleTick((n) => n + 1);
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  /* ------------------------------------------------------------ commands --- */

  const runCommand = useCallback(
    async <T extends { player: PlayerState }>(action: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await action();
        applyPlayer(result.player);
        return result;
      } catch (e) {
        sfx.bad();
        say(e instanceof ApiError ? (e.message || e.code) : 'Something went wrong');
        return null;
      }
    },
    [applyPlayer, say],
  );

  const confirmPlacement = useCallback(async () => {
    const world = worldRef.current;
    const place = world?.placement;
    if (!world || !place) return;
    if (!place.ok) {
      say('That spot is blocked');
      return;
    }

    const done = place.movingId
      ? await runCommand(() => api.move(place.movingId!, place.gx, place.gy))
      : await runCommand(() => api.build(place.type, place.gx, place.gy));

    if (!done) return;
    sfx.place();
    if (place.movingId) bump(world, place.movingId);
    cancelPlacement(world);
    setModeState('base');

    // A rampart keeps the tool loaded so a run of them can be laid in one go,
    // exactly as in the prototype.
    if (!place.movingId && place.type === 'wall') {
      startPlacement(world, 'wall', null);
      setModeState('place');
    }
  }, [runCommand, say]);

  const collect = useCallback(async (buildingId?: string) => {
    const world = worldRef.current;
    const target = world?.player?.buildings.find((b) => b.id === buildingId);
    const result = await runCommand(() => api.collect(buildingId));
    if (!result || !world || !target) return;

    const amount = result.collected.gold + result.collected.iron;
    if (amount > 0) {
      sfx.coin();
      const s = TYPES[target.type].s;
      popup(world, target.gx + s / 2, target.gy + s / 2, '+' + fmt(amount),
        target.type === 'mine' ? '#ffd25c' : '#c3d2e0');
      bump(world, target.id);
    }
    if (result.wasted.gold + result.wasted.iron > 0) say('Storage is full — build or raise a Vault');
    void loadQuests();
  }, [runCommand, say, loadQuests]);

  /** Empty every producer at once. Twelve taps is a chore, not a decision. */
  const collectAll = useCallback(async () => {
    const world = worldRef.current;
    const producers = (world?.player?.buildings ?? []).filter((b) => PROD[b.type] && b.stock >= 1);
    const result = await runCommand(() => api.collect());
    if (!result) return;

    if (result.collected.gold + result.collected.iron > 0) {
      sfx.coin();
      for (const b of producers) {
        const s = TYPES[b.type].s;
        if (world) {
          popup(world, b.gx + s / 2, b.gy + s / 2, '+' + fmt(Math.floor(b.stock)),
            b.type === 'mine' ? '#ffd25c' : '#c3d2e0');
          bump(world, b.id);
        }
      }
    }
    if (result.wasted.gold + result.wasted.iron > 0) say('Storage is full — build or raise a Vault');
    void loadQuests();
  }, [runCommand, say, loadQuests]);

  const claimQuest = useCallback(async (questId: string) => {
    setClaimingQuest(questId);
    const result = await runCommand(() => api.claimQuest(questId));
    setClaimingQuest(null);
    if (!result) return;
    sfx.up();
    say(`Reward claimed: ${rewardText(result.reward)}`);
    void loadQuests();
  }, [runCommand, say, loadQuests]);

  /* --------------------------------------------------------------- raids --- */

  const findRaid = useCallback(async (reroll = false) => {
    const found = await runCommand(() => api.findRaid(reroll));
    if (!found) return;
    setScout(found);
    setSheet(null);
    setSelectedId(null);
    if (worldRef.current) showPreview(worldRef.current, found.snapshot);
  }, [runCommand]);

  const attack = useCallback(() => {
    const world = worldRef.current;
    if (!world || !scout) return;
    setScout(null);
    setSheet(null);
    setSelectedId(null);
    beginBattle(world, scout);
    setModeState('battle');
  }, [scout]);

  /**
   * A battle ended. Send the deploys that were played and take the server's
   * word for the result, whatever the client just rendered.
   */
  const finishBattle = useCallback(async (commands: DeployCommand[]) => {
    const world = worldRef.current;
    if (!world || !world.raid || !world.battle) return;
    const local = world.battle.result();
    const raidId = world.raid.raidId;

    setOutcome({
      stars: local.stars,
      destroyedPct: local.destroyedPct,
      loot: local.loot,
      trophyDelta: 0,
      commands,
      pending: true,
    });
    setMode(world, 'base');
    setModeState('base');
    world.battle = null;
    world.raid = null;
    centerOnKeep(world);

    const settled = await runCommand(() =>
      api.submitRaid(raidId, commands, local.checksum, local.stars));

    if (settled) {
      if (settled.stars >= 1) sfx.win(); else sfx.bad();
      // The server's numbers replace the client's, always.
      setOutcome({
        stars: settled.stars,
        destroyedPct: settled.destroyedPct,
        loot: settled.loot,
        trophyDelta: settled.trophyDelta,
        commands,
        pending: false,
      });
      void api.incoming().then((r) => setIncoming(r.raids)).catch(() => undefined);
    void loadQuests();
    } else {
      setOutcome(null);
    }
  }, [runCommand]);

  /* ------------------------------------------------------------ handlers --- */

  const events = {
    onSelect: setSelectedId,
    onModeChange: setModeState,
    onToast: say,
    onPlayerChanged: () => setBattleTick((n) => n + 1),
    onBattleEnd: (commands: DeployCommand[]) => { void finishBattle(commands); },
  };

  const onTapBuilding = useCallback((id: string | null) => {
    // Browsers keep an AudioContext suspended until a real gesture.
    unlockAudio();
    const world = worldRef.current;
    if (!world) return;
    const building = id ? world.player?.buildings.find((b) => b.id === id) : null;

    // Tapping a producer with a full pouch collects it rather than selecting it.
    if (building && building.stock >= 1 && (building.type === 'mine' || building.type === 'forge')) {
      void collect(building.id);
      return;
    }
    if (id) sfx.tap();
    world.selectedId = id;
    setSelectedId(id);
  }, [collect]);

  const selected = player?.buildings.find((b) => b.id === selectedId) ?? null;
  const world = worldRef.current;
  const battle = world?.battle ?? null;

  // Read off the world rather than React state: the local production prediction
  // advances every frame, and mirroring that into state would re-render the
  // whole tree sixty times a second.
  const pendingStock = Math.floor(
    (world?.player?.buildings ?? []).reduce((sum, b) => sum + (PROD[b.type] ? b.stock : 0), 0),
  );

  // A player who has collected, raided or climbed has a hold worth keeping.
  const investedEnough = player
    ? (player.counters.collected ?? 0) >= 3
      || (player.counters.wins ?? 0) > 0
      || player.trophies > 0
      || player.keepLevel > 1
    : false;
  const showGuestNote = Boolean(player?.isGuest) && investedEnough && !guestNoteDismissed;

  const ordersReady = player
    ? hasClaimableQuest(player.claimedQuests, {
        counters: player.counters,
        buildings: player.buildings.map((b) => ({ type: b.type, level: b.level })),
        trophies: player.trophies,
      })
    : false;

  /* ----------------------------------------------------------------- ui --- */

  if (signedIn === false) {
    return (
      <SignInModal
        sent={signInSent}
        busy={signInBusy}
        error={signInError}
        onGuest={() => {
          unlockAudio();
          setSignInBusy(true);
          setSignInError(null);
          api.guest()
            .then(() => refresh())
            .catch(() => setSignInError('Could not raise a hold. Try again in a moment.'))
            .finally(() => setSignInBusy(false));
        }}
        onRequest={(email) => {
          setSignInBusy(true);
          setSignInError(null);
          api.requestLogin(email)
            .then(() => setSignInSent(true))
            .catch(() => setSignInError('Could not send that. Try again in a minute.'))
            .finally(() => setSignInBusy(false));
        }}
      />
    );
  }

  return (
    <>
      <GameCanvas
        events={events}
        onReady={(w) => {
          worldRef.current = w;
          if (player) w.player = player;
          centerOnKeep(w);
        }}
        onTapBuilding={onTapBuilding}
      />

      {player && mode !== 'battle' && (
        <Hud
          player={player}
          incomingCount={incoming.length}
          ordersReady={ordersReady}
          pending={pendingStock}
          onHome={() => { if (worldRef.current) centerOnKeep(worldRef.current); }}
          onBuild={() => { sfx.tap(); setSheet('build'); }}
          onArmy={() => { sfx.tap(); setSheet('army'); }}
          onOrders={() => { sfx.tap(); setSheet('orders'); void loadQuests(); }}
          onLog={() => { sfx.tap(); setSheet('log'); }}
          onRaid={() => { unlockAudio(); sfx.tap(); void findRaid(false); }}
          onCollectAll={() => { void collectAll(); }}
          onClaimAccount={() => { setClaimOpen(true); setClaimSent(false); setClaimError(null); }}
          soundOn={soundOn}
          onToggleSound={() => {
            const next = !soundOn;
            setSoundEnabled(next);
            setSoundOn(next);
            // Play the confirmation after enabling, so the toggle proves itself.
            if (next) { unlockAudio(); sfx.tap(); }
          }}
          showGuestNote={showGuestNote}
          onDismissGuestNote={() => {
            setGuestNoteDismissed(true);
            try {
              localStorage.setItem('ironvow_guest_note', 'off');
            } catch {
              // Nothing to do; it will ask again next session.
            }
          }}
        />
      )}

      {mode === 'battle' && battle && (
        <BattleHud
          secondsLeft={battle.secondsLeft()}
          destroyedPct={battle.destroyedPct()}
          stars={battle.stars()}
          avail={battle.avail}
          selected={world?.selectedTroop ?? null}
          onSelect={(t: TroopType) => { if (world) world.selectedTroop = t; }}
          onEnd={() => { if (world?.battle) void finishBattle(world.battleCommands); }}
        />
      )}

      {mode === 'base' && selected && player && (
        <Inspector
          player={player}
          building={selected}
          onClose={() => { setSelectedId(null); if (world) world.selectedId = null; }}
          onUpgrade={() => { void runCommand(() => api.upgrade(selected.id)); }}
          onMove={() => {
            if (!world) return;
            setSelectedId(null);
            startPlacement(world, selected.type, selected.id);
            setModeState('place');
          }}
          onCollect={() => { void collect(selected.id); }}
        />
      )}

      {mode === 'place' && world?.placement && (
        <PlaceBar
          typeName={TYPES[world.placement.type].n}
          moving={world.placement.movingId !== null}
          ok={world.placement.ok}
          onCancel={() => { cancelPlacement(world); setModeState('base'); }}
          onConfirm={() => { void confirmPlacement(); }}
        />
      )}

      {sheet === 'build' && player && (
        <BuildSheet
          player={player}
          onClose={() => setSheet(null)}
          onPick={(type: BuildingType) => {
            if (!world) return;
            setSheet(null);
            startPlacement(world, type, null);
            setModeState('place');
          }}
        />
      )}

      {sheet === 'army' && player && (
        <ArmySheet
          player={player}
          onClose={() => setSheet(null)}
          onTrain={(type, count) => { void runCommand(() => api.train(type, count)); }}
        />
      )}

      {sheet === 'orders' && (
        <QuestSheet
          quests={quests}
          busyId={claimingQuest}
          onClose={() => setSheet(null)}
          onClaim={(id) => { void claimQuest(id); }}
        />
      )}

      {sheet === 'log' && (
        <LogSheet
          raids={incoming}
          onClose={() => setSheet(null)}
          onReplay={(raidId) => {
            void api.replay(raidId).then((r) => {
              if (!worldRef.current) return;
              setSheet(null);
              beginBattle(worldRef.current, {
                raidId: r.raidId, seed: r.seed, snapshot: r.snapshot, army: r.army,
                expiresAt: new Date().toISOString(), rerollCost: 0,
              });
              // A replay is watched, not played: feed it the recorded commands.
              for (const c of r.commands) worldRef.current.battleCommands.push(c);
              setModeState('battle');
            }).catch(() => say('That raid cannot be replayed'));
          }}
        />
      )}

      {scout && player && (
        <ScoutModal
          snapshot={scout.snapshot}
          rerollCost={scout.rerollCost}
          canReroll={player.gold >= scout.rerollCost}
          onAttack={attack}
          onReroll={() => { void findRaid(true); }}
          onCancel={() => {
            setScout(null);
            if (worldRef.current) clearPreview(worldRef.current);
          }}
        />
      )}

      {outcome && !outcome.pending && (
        <ResultModal
          stars={outcome.stars}
          loot={outcome.loot}
          trophyDelta={outcome.trophyDelta}
          onStar={(i) => sfx.star(i)}
          onClose={() => setOutcome(null)}
        />
      )}

      {claimOpen && (
        <ClaimModal
          sent={claimSent}
          busy={signInBusy}
          error={claimError}
          onSubmit={(email) => {
            setSignInBusy(true);
            setClaimError(null);
            api.claimAccount(email)
              .then(() => setClaimSent(true))
              .catch((e: unknown) => setClaimError(
                e instanceof ApiError && e.code === 'emailTaken'
                  ? 'That address already holds a base.'
                  : 'Could not send that. Try again in a minute.',
              ))
              .finally(() => setSignInBusy(false));
          }}
          onClose={() => setClaimOpen(false)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
