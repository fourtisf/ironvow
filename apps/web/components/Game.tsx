'use client';

import {
  HERO_UNLOCK_KEEP_LEVEL,
  PROD,
  TROOP_ORDER,
  TYPES,
  hasClaimableQuest,
  type BuildingType,
} from '@ironvow/config';
import type { DeployCommand } from '@ironvow/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type DailyView } from '../lib/api';
import {
  beginBattle,
  bump,
  cancelPlacement,
  centerOnKeep,
  clearPreview,
  popup,
  setMode,
  setQuality as applyQuality,
  showPreview,
  startPlacement,
  type World,
} from '../lib/game/world';
import type { BattleOutcome, Mode, PlayerState, ScoutedRaid } from '../lib/game/types';
import { fmt } from '../lib/format';
import { loadSoundPreference, setSfxVolume, sfx, unlockAudio } from '../lib/sfx';
import { loadMusicPreference, setMusicVolume, startMusic, stopMusic, unlockMusic } from '../lib/music';
import { BattleHud } from './BattleHud';
import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';
import { Inspector, PlaceBar } from './Inspector';
import { ClaimModal, ConfirmModal, ResultModal, ScoutModal, SignInModal } from './Modals';
import { ClanSheet } from './ClanSheet';
import { QuestSheet, rewardText, type QuestRow } from './QuestSheet';
import { ArmySheet, BuildSheet, LadderSheet, LogSheet, type LadderRow, type ProgressionView } from './Sheets';
import { SettingsSheet, type LayoutSlot, type Quality } from './Settings';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { Toast } from './Toast';

/**
 * The shell.
 *
 * React owns the HUD, the sheets and the modals. The field owns itself — the
 * canvas is driven by requestAnimationFrame against a mutable world in a ref,
 * and the only traffic between them is this component pushing the latest
 * server state down and the world calling back when the player does something.
 */

type Sheet = 'build' | 'army' | 'orders' | 'log' | 'clan' | 'ladder' | 'settings' | null;

/** The player's own row, pinned when they are not in the top fifty. */
type LadderSheetMe = { name: string; trophies: number; rank: number } | null;

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
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [claimingQuest, setClaimingQuest] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimSent, setClaimSent] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [guestNoteDismissed, setGuestNoteDismissed] = useState(false);
  const [progression, setProgression] = useState<ProgressionView | null>(null);
  const [sfxLevel, setSfxLevel] = useState(1);
  const [musicLevel, setMusicLevel] = useState(0.35);
  const [quality, setQuality] = useState<Quality>('high');
  const [ladder, setLadder] = useState<{ top: LadderRow[]; me: LadderSheetMe; total: number } | null>(null);
  const [push, setPush] = useState<PushState>('off');
  const [layouts, setLayouts] = useState<LayoutSlot[]>([]);
  const [busy, setBusy] = useState(false);
  /** Anything with no undo goes through one confirmation. */
  const [confirm, setConfirm] = useState<{
    title: string; lead: string; label: string; danger?: boolean;
    requireTyped?: string; run: () => void;
  } | null>(null);
  /** Bumped once a frame while a battle runs, so the battle HUD tracks it. */
  const [battleTick, setBattleTick] = useState(0);

  /* --- toasts are the game's only error channel, as in the prototype --- */
  const say = useCallback((message: string) => setToast(message + '​'.repeat(Math.random() * 3 | 0)), []);

  /** Frame the hold once, on the first load, not on every poll. */
  const framed = useRef(false);

  /**
   * How long each job was, by building id.
   *
   * The server sends a finish time, not a duration, and it is right to: a
   * duration would go stale the moment the response was delayed. But a progress
   * bar needs to know how far along a job is, so the client remembers the length
   * of anything it started itself. A reload loses that and the bar simply fills
   * over whatever time is left, which is honest if less pretty.
   */
  const jobLengths = useRef(new Map<string, number>());

  const rememberJob = useCallback((buildingId: string, seconds: number) => {
    if (seconds > 0) jobLengths.current.set(buildingId, seconds);
  }, []);

  const applyPlayer = useCallback((next: PlayerState) => {
    setPlayer(next);
    const world = worldRef.current;
    if (world) {
      // Preserve the local bump animation across a server refresh, so a
      // building that was just placed does not stop mid-pop.
      const bumps = new Map(world.player?.buildings.map((b) => [b.id, b.bump]) ?? []);
      world.player = {
        ...next,
        buildings: next.buildings.map((b) => ({
          ...b,
          bump: bumps.get(b.id),
          jobSeconds: jobLengths.current.get(b.id),
        })),
      };
      // Forget the length of anything no longer being built, so the map does
      // not grow for the life of the session.
      for (const id of [...jobLengths.current.keys()]) {
        if (!next.buildings.some((b) => b.id === id && b.completesAt !== null)) {
          jobLengths.current.delete(id);
        }
      }

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
    setSfxLevel(loadSoundPreference());
    setMusicLevel(loadMusicPreference());
    try {
      const savedQuality = localStorage.getItem('ironvow_quality');
      if (savedQuality === 'low' || savedQuality === 'high') setQuality(savedQuality);
    } catch {
      // Falls back to full quality.
    }
    try {
      setGuestNoteDismissed(localStorage.getItem('ironvow_guest_note') === 'off');
    } catch {
      // Private browsing refuses storage; the note simply reappears next visit.
    }
  }, []);

  // The saved preference is read after the first paint, by which time the
  // canvas has already been created at full quality; without this the setting
  // only took effect when the player toggled it by hand.
  useEffect(() => {
    if (worldRef.current) applyQuality(worldRef.current, quality);
  }, [quality]);

  const loadProgression = useCallback(async () => {
    try {
      setProgression(await api.progression());
    } catch {
      // The panels fall back to a quiet placeholder rather than a toast.
    }
  }, []);

  const loadQuests = useCallback(async () => {
    try {
      const [list, today] = await Promise.all([api.quests(), api.daily()]);
      setQuests(list.quests);
      setDaily(today);
    } catch {
      // The orders sheet is not worth a toast; the rail dot just stays quiet.
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void api.incoming().then((r) => setIncoming(r.raids)).catch(() => undefined);
    void loadQuests();
    void loadProgression();
    void pushState().then(setPush).catch(() => undefined);
    void api.layouts().then((r) => setLayouts(r.layouts)).catch(() => undefined);
    // The server settles production lazily, so a periodic re-read is what keeps
    // the HUD honest without a socket.
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [signedIn, refresh, loadQuests, loadProgression]);

  /*
   * Music follows what is happening.
   *
   * The hold gets a slow progression with no percussion, and a raid gets a
   * pulse: the silence in between is what makes the base feel like somewhere
   * safe rather than just a quieter fight.
   */
  useEffect(() => {
    if (!signedIn) return;
    if (musicLevel <= 0) {
      stopMusic();
      return;
    }
    startMusic(mode === 'battle' ? 'battle' : 'base');
  }, [signedIn, mode, musicLevel]);

  useEffect(() => () => stopMusic(), []);

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
    else if ('buildingId' in done && 'seconds' in done) {
      rememberJob(done.buildingId as string, done.seconds as number);
    }
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

  const claimDaily = useCallback(async (orderId: string) => {
    setClaimingQuest(orderId);
    const result = await runCommand(() => api.claimDaily(orderId));
    setClaimingQuest(null);
    if (!result) return;
    sfx.coin();
    say(`Order done — ${rewardText(result.reward)}`);
    if (result.wasted.gold + result.wasted.iron > 0) say('Storage was full — some of it was lost');
    setDaily(result.daily);
  }, [runCommand, say]);

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
    /*
     * Ported back from the prototype, which refused to open a raid with an
     * empty warband. Without it a new player taps RAID, finds a garrison,
     * attacks with nothing, and watches a three-minute timer run out — which
     * looks exactly like the game being broken.
     *
     * The hero counts: it is a real unit and a raid with only the hero is a
     * legitimate, if ambitious, plan.
     */
    const troops = TROOP_ORDER.reduce((n, t) => n + (player?.army[t] ?? 0), 0);
    const heroReady = Boolean(player)
      && player!.keepLevel >= HERO_UNLOCK_KEEP_LEVEL
      && player!.heroReadyAt === null;
    if (troops === 0 && !heroReady) {
      sfx.bad();
      say('Train troops in ARMY before you raid');
      setSheet('army');
      return;
    }

    const found = await runCommand(() => api.findRaid(reroll));
    if (!found) return;
    setScout(found);
    setSheet(null);
    setSelectedId(null);
    if (worldRef.current) showPreview(worldRef.current, found.snapshot);
    // `player` and `say` belong here: without them this closure keeps the state
    // it was created with, which is null, and every RAID tap is answered with
    // "train troops first" no matter how large the warband is.
  }, [player, runCommand, say]);

  const demolish = useCallback((buildingId: string) => {
    const b = player?.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    setConfirm({
      title: `TEAR DOWN THE ${TYPES[b.type].n.toUpperCase()}?`,
      lead: 'Half of everything that went into it comes back, and the slot it '
        + 'was using is free again. The building itself is gone.',
      label: 'DEMOLISH',
      danger: true,
      run: () => {
        setConfirm(null);
        setSelectedId(null);
        void runCommand(() => api.demolish(buildingId)).then((r) => {
          if (!r) return;
          sfx.boom();
          say(`Refunded ${fmt(r.refund.g)} gold, ${fmt(r.refund.i)} iron`);
          if (r.wasted.gold + r.wasted.iron > 0) say('Storage was full — some of the refund was lost');
        });
      },
    });
  }, [player, runCommand, say]);

  const cancelBuild = useCallback((buildingId: string) => {
    void runCommand(() => api.cancelBuild(buildingId)).then((r) => {
      if (!r) return;
      sfx.tap();
      say(r.removes ? 'Build cancelled and refunded' : 'Upgrade cancelled and refunded');
      setSelectedId(null);
    });
  }, [runCommand, say]);

  const cancelTraining = useCallback((jobId: string) => {
    void runCommand(() => api.cancelTraining(jobId)).then((r) => {
      if (r) { sfx.tap(); say(`Refunded ${fmt(r.refund.g)} gold`); }
    });
  }, [runCommand, say]);

  const loadLadder = useCallback(async () => {
    try {
      setLadder(await api.leaderboard());
    } catch {
      // The sheet shows its empty state rather than a toast.
    }
  }, []);

  const revenge = useCallback(async (raidId: string) => {
    const found = await runCommand(() => api.revenge(raidId));
    if (!found) return;
    setScout(found);
    setSheet(null);
    setSelectedId(null);
    if (worldRef.current) showPreview(worldRef.current, found.snapshot);
  }, [runCommand, player, say]);

  /**
   * A practice wave against your own hold.
   *
   * The simulation has supported defending since it was written and nothing
   * ever called it. Nothing is at stake here — no loot, no trophies, no record
   * — because the point is to find out whether a layout holds before somebody
   * else finds out for you.
   */
  const drill = useCallback(async () => {
    const world = worldRef.current;
    if (!world) return;
    try {
      const d = await api.defend();
      applyPlayer(d.player);
      setSheet(null);
      setSelectedId(null);
      beginBattle(world, {
        raidId: '',
        seed: d.seed,
        snapshot: d.snapshot,
        army: d.army,
        hero: d.hero,
        troopLevels: d.troopLevels,
        expiresAt: new Date().toISOString(),
        rerollCost: 0,
      }, 'defend');
      setModeState('battle');
      say('Hold the line — your defences are firing');
    } catch {
      say('Could not start a drill');
    }
  }, [applyPlayer, say]);

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
    const isDrill = raidId === '';

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

    /*
     * A drill has no raid row and nothing to settle. Ending it locally is the
     * whole point: nothing was at stake, so there is nothing to write down.
     */
    if (isDrill) {
      setOutcome({
        stars: local.stars,
        destroyedPct: local.destroyedPct,
        loot: { g: 0, i: 0 },
        trophyDelta: 0,
        commands,
        pending: false,
      });
      return;
    }

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
    (world?.player?.buildings ?? []).reduce((sum, b) => {
      const goingUp = b.completesAt !== null && b.upgradingTo === null;
      return sum + (PROD[b.type] && !goingUp ? b.stock : 0);
    }, 0),
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
          applyQuality(w, quality);
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
          onArmy={() => { sfx.tap(); setSheet('army'); void loadProgression(); }}
          onOrders={() => { sfx.tap(); setSheet('orders'); void loadQuests(); }}
          onClan={() => { sfx.tap(); setSheet('clan'); }}
          onLog={() => { sfx.tap(); setSheet('log'); }}
          onLadder={() => { sfx.tap(); setSheet('ladder'); void loadLadder(); }}
          onRaid={() => { unlockAudio(); sfx.tap(); void findRaid(false); }}
          onCollectAll={() => { void collectAll(); }}
          onClaimAccount={() => { setClaimOpen(true); setClaimSent(false); setClaimError(null); }}
          soundOn={sfxLevel > 0 || musicLevel > 0}
          onToggleSound={() => { sfx.tap(); setSheet('settings'); }}
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
          heroReady={battle.heroReady()}
          heroLevel={world?.raid?.hero.level ?? player?.heroLevel ?? 1}
          onSelect={(t) => { if (world) { world.selectedTroop = t; sfx.tap(); } }}
          onEnd={() => { if (world?.battle) void finishBattle(world.battleCommands); }}
        />
      )}

      {mode === 'base' && selected && player && (
        <Inspector
          player={player}
          building={selected}
          onClose={() => { setSelectedId(null); if (world) world.selectedId = null; }}
          onUpgrade={() => {
            void runCommand(() => api.upgrade(selected.id)).then((r) => {
              if (!r) return;
              sfx.place();
              rememberJob(selected.id, r.seconds);
              if (r.seconds > 0) say(`Builder started — ready in ${Math.max(1, Math.round(r.seconds / 60))} min`);
            });
          }}
          onFinish={() => {
            void runCommand(() => api.finish(selected.id)).then((r) => {
              if (r) { sfx.up(); say(`Finished for ${fmt(r.cost)} gold`); }
            });
          }}
          onMove={() => {
            if (!world) return;
            setSelectedId(null);
            startPlacement(world, selected.type, selected.id);
            setModeState('place');
          }}
          onCollect={() => { void collect(selected.id); }}
          onDemolish={() => demolish(selected.id)}
          onCancel={() => cancelBuild(selected.id)}
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

      {sheet === 'clan' && player && (
        <ClanSheet
          player={player}
          onClose={() => setSheet(null)}
          onToast={say}
          onPlayerChanged={() => { void refresh(); }}
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
          progression={progression}
          onClose={() => setSheet(null)}
          onTrain={(type, count) => { void runCommand(() => api.train(type, count)); }}
          onCancelJob={cancelTraining}
          onUpgradeHero={() => {
            void runCommand(() => api.upgradeHero()).then((r) => {
              if (r) { sfx.up(); say(`Hero raised to rank ${r.toLevel}`); void loadProgression(); }
            });
          }}
          onUpgradeTroop={(type) => {
            void runCommand(() => api.upgradeTroop(type)).then((r) => {
              if (r) { sfx.up(); say(`Troop upgraded to level ${r.toLevel}`); void loadProgression(); }
            });
          }}
        />
      )}

      {sheet === 'orders' && (
        <QuestSheet
          quests={quests}
          daily={daily}
          onClaimDaily={(id) => { void claimDaily(id); }}
          busyId={claimingQuest}
          onClose={() => setSheet(null)}
          onClaim={(id) => { void claimQuest(id); }}
        />
      )}

      {sheet === 'ladder' && ladder && (
        <LadderSheet
          top={ladder.top}
          me={ladder.me}
          total={ladder.total}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'settings' && player && (
        <SettingsSheet
          music={musicLevel}
          sfx={sfxLevel}
          quality={quality}
          isGuest={player.isGuest}
          playerName={player.name}
          onMusic={(v) => {
            setMusicLevel(v);
            setMusicVolume(v);
            if (v > 0) { unlockMusic(); startMusic(mode === 'battle' ? 'battle' : 'base'); }
          }}
          onSfx={(v) => {
            setSfxLevel(v);
            setSfxVolume(v);
            // Play the confirmation after raising it, so the slider proves itself.
            if (v > 0) { unlockAudio(); sfx.coin(); }
          }}
          onQuality={(q) => {
            setQuality(q);
            if (worldRef.current) applyQuality(worldRef.current, q);
            try {
              localStorage.setItem('ironvow_quality', q);
            } catch {
              // Falls back to full quality next session.
            }
          }}
          push={push}
          layouts={layouts}
          busy={busy}
          onPush={(on) => {
            setBusy(true);
            const work = on ? enablePush() : disablePush();
            void work
              .then((next) => {
                setPush(next);
                if (next === 'on') say('Notifications on');
                if (next === 'denied') say('Your browser is blocking notifications');
              })
              .catch(() => say('Could not change notifications'))
              .finally(() => setBusy(false));
          }}
          onTestPush={() => {
            setBusy(true);
            void api.pushTest()
              .then((r) => say(r.sent > 0 ? 'Sent — check your notifications' : 'No device registered'))
              .catch(() => say('Could not send'))
              .finally(() => setBusy(false));
          }}
          onSaveLayout={(slot) => {
            setBusy(true);
            void api.saveLayout(slot)
              .then((r) => { sfx.up(); say(`Saved ${r.buildings} buildings`); return api.layouts(); })
              .then((r) => setLayouts(r.layouts))
              .catch(() => say('Could not save that layout'))
              .finally(() => setBusy(false));
          }}
          onApplyLayout={(slot) => {
            setBusy(true);
            void runCommand(() => api.applyLayout(slot))
              .then((r) => {
                if (!r) return;
                sfx.place();
                say(r.moved === 0 ? 'Already in that arrangement' : `Moved ${r.moved} buildings`);
              })
              .finally(() => setBusy(false));
          }}
          onRename={() => {
            const next = window.prompt('Name your hold', player.name);
            if (!next || next.trim() === player.name) return;
            void api.rename(next.trim())
              .then(() => { sfx.up(); say('Renamed'); return refresh(); })
              .catch((e: unknown) => say(
                e instanceof ApiError && e.code === 'nameTaken'
                  ? 'Somebody already holds that name'
                  : 'That name will not do',
              ));
          }}
          onDeleteAccount={() => {
            setConfirm({
              title: 'DELETE THIS HOLD?',
              lead: 'Everything goes: buildings, troops, trophies, raid history. '
                + 'Type your hold’s name to confirm. There is no way back.',
              label: 'DELETE FOREVER',
              danger: true,
              requireTyped: player.name,
              run: () => {
                setConfirm(null);
                void api.deleteAccount(player.name)
                  .then(() => { stopMusic(); setSignedIn(false); setPlayer(null); })
                  .catch(() => say('Could not delete the account'));
              },
            });
          }}
          onClaimAccount={() => { setClaimOpen(true); setClaimSent(false); setClaimError(null); }}
          onLogout={() => {
            void api.logout().then(() => {
              stopMusic();
              setSignedIn(false);
              setPlayer(null);
            });
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'log' && (
        <LogSheet
          raids={incoming}
          onRevenge={(id) => { void revenge(id); }}
          onDrill={() => { void drill(); }}
          onClose={() => setSheet(null)}
          onReplay={(raidId) => {
            void api.replay(raidId).then((r) => {
              if (!worldRef.current) return;
              setSheet(null);
              beginBattle(worldRef.current, {
                raidId: r.raidId, seed: r.seed, snapshot: r.snapshot, army: r.army,
                hero: r.hero, troopLevels: r.troopLevels,
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
          isPlayer={scout.isPlayer !== false}
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

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          lead={confirm.lead}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          requireTyped={confirm.requireTyped}
          onConfirm={confirm.run}
          onCancel={() => setConfirm(null)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
