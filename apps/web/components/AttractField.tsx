'use client';

import { useEffect, useRef } from 'react';
import { TH, TW, TYPES, clamp } from '@ironvow/config';
import { centerOn } from '../lib/render/camera';
import { renderFrame } from '../lib/game/render';
import { showcaseHold } from '../lib/game/showcase';
import { watchPhase } from '../lib/game/daylight';
import { createWorld, decayFx, resizeWorld, setPhase, showPreview, stepSky, type World, type WorldEvents } from '../lib/game/world';

/**
 * The field behind the door.
 *
 * The access code and sign-in cards used to sit on a flat dark rectangle,
 * which is the one screen every player sees and the one that said least
 * about the game. This is the same renderer, the same terrain and the same
 * art, drawing a generated hold with the camera drifting slowly around it.
 *
 * Deliberately self-contained: its own world, no input, no player, no events.
 * Nothing here can reach the game's state machine, so a login screen cannot
 * disturb a hold — and when the player is let in, the real canvas mounts
 * fresh with its own world.
 */

/** Seconds for one full circuit of the drift. */
const ORBIT_SECONDS = 70;
/** How far the camera wanders from the middle, in tiles. */
const ORBIT_TILES = 3.2;

const NOWHERE: WorldEvents = {
  onSelect: () => undefined,
  onModeChange: () => undefined,
  onToast: () => undefined,
  onPlayerChanged: () => undefined,
  onBattleEnd: () => undefined,
  onPlacementChanged: () => undefined,
  onPlacementCommit: () => undefined,
  onCameraMoved: () => undefined,
  onBoard: () => undefined,
};

export function AttractField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const world: World = createWorld(NOWHERE);

    /*
     * A finished hold, in the player's own colours.
     *
     * It used to be a generated garrison at stage four — a mid-game opponent,
     * level-three buildings, none of the art the game spends its levels on —
     * drawn in enemy red. This is the first screen anybody ever sees, so it
     * shows the end of the game rather than the middle of it, and the livery
     * somebody is being invited to build rather than one to attack.
     */
    /*
     * The first screen is under the same sky as the game behind it. Somebody
     * opening a link at eleven at night should not be shown a bright noon and
     * then dropped into the dark.
     */
    const unwatchSky = watchPhase((phase) => setPhase(world, phase));

    const snapshot = showcaseHold();
    world.resize = () => resizeWorld(world, canvas, ctx);
    world.resize();
    showPreview(world, snapshot, false);

    let cx = 0;
    let cy = 0;
    for (const b of snapshot.buildings) {
      const s = TYPES[b.type].s;
      cx += b.gx + s / 2;
      cy += b.gy + s / 2;
    }
    cx /= Math.max(1, snapshot.buildings.length);
    cy /= Math.max(1, snapshot.buildings.length);

    /*
     * Well back from the hold.
     *
     * `showPreview` fits the base to the window, which is right when the
     * player is studying a base they are about to raid and wrong here: it
     * filled the screen with rooftops. The hold is given about half the
     * width, so the plateau, the treeline and the water around it are what
     * the card sits on. Held for the whole drift, because zoom is snapped to
     * whole device pixels for the terrain pattern and a changing one steps.
     */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of snapshot.buildings) {
      const s = TYPES[b.type].s;
      minX = Math.min(minX, b.gx); maxX = Math.max(maxX, b.gx + s);
      minY = Math.min(minY, b.gy); maxY = Math.max(maxY, b.gy + s);
    }
    const spanW = ((maxX - minY) - (minX - maxY)) * (TW / 2);
    const spanH = ((maxX + maxY) - (minX + minY)) * (TH / 2);
    /*
     * Two framings, because the two screens have nothing in common.
     *
     * On a wide screen the whole hold fits beside the card, and that is the
     * picture: a finished base, walls and all. The floor here is lower than
     * anywhere in the game — `ZOOM_MIN` is how far back a *player* may pull, so
     * a raid cannot be fought from orbit, and this is not a raid.
     *
     * A phone has about a hundred and fifty pixels above the card. A hold
     * thirty tiles across cannot be both inside that strip and worth looking
     * at: fitted, it is a smudge behind the card. So the phone gets a detail
     * instead — the Keep at the top of its levels, gilded, with the curtain
     * wall and the statues around it. One good building beats a whole base
     * nobody can make out.
     */
    const ATTRACT_ZOOM_MIN = 0.14;
    const wideScreen = world.vp.w >= 760;
    const zoom = wideScreen
      ? clamp(
        Math.min((world.vp.w * 0.5) / Math.max(1, spanW), (world.vp.h * 0.5) / Math.max(1, spanH)),
        ATTRACT_ZOOM_MIN,
        0.6,
      )
      : 0.5;
    // And the phone looks at the Keep rather than the middle of the whole
    // sprawl, which on a maxed hold is a stretch of curtain wall.
    if (!wideScreen) {
      const keep = snapshot.buildings.find((b) => b.type === 'keep');
      if (keep) {
        cx = keep.gx + TYPES.keep.s / 2;
        cy = keep.gy + TYPES.keep.s / 2;
      }
    }

    /*
     * The hold stands beside the card, not behind it.
     *
     * Centred, the card covered the very thing it was meant to be standing
     * on. So the camera looks a little past the hold: to its right on a wide
     * screen, which pushes the hold into the left third, and below it on a
     * phone, which lifts the hold above the card. Worked in grid units so the
     * camera clamp still applies — screen x runs along (+1,-1) in the grid,
     * screen y along (+1,+1).
     */
    const offsetFor = (): [number, number] => {
      const wide = world.vp.w >= 760;
      const leftPx = wide ? world.vp.w * 0.23 : 0;
      const upPx = wide ? 0 : world.vp.h * 0.29;
      const u = (2 * (leftPx / zoom)) / TW;
      const v = (2 * (upPx / zoom)) / TH;
      return [(u + v) / 2, (v - u) / 2];
    };
    let [ox, oy] = offsetFor();

    const onResize = (): void => {
      world.resize?.();
      [ox, oy] = offsetFor();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      world.t += dt;
      world.now = Date.now();

      // A slow ellipse, wider than it is tall so the movement reads as a
      // camera looking around rather than a turntable.
      const a = (world.t / ORBIT_SECONDS) * Math.PI * 2;
      centerOn(
        world.cam,
        cx + ox + Math.cos(a) * ORBIT_TILES,
        cy + oy + Math.sin(a) * ORBIT_TILES * 0.6,
        zoom,
        world.vp.dpr,
        ATTRACT_ZOOM_MIN,
      );

      decayFx(world, dt);
      stepSky(world, dt);
      renderFrame(world, ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unwatchSky();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      world.resize = null;
    };
  }, []);

  // Behind everything and deaf to the pointer: the cards on top own every tap.
  return <canvas ref={canvasRef} id="attract" aria-hidden />;
}
