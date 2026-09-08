'use client';

import { useEffect, useRef } from 'react';
import type { DeployCommand, ItemCommand } from '@ironvow/types';
import { watchPhase } from '../lib/game/daylight';
import { attachInput } from '../lib/game/input';
import { renderFrame } from '../lib/game/render';
import {
  createWorld,
  decayFx,
  predictProduction,
  resizeWorld,
  setPhase,
  stepBattle,
  stepSky,
  type World,
  type WorldEvents,
} from '../lib/game/world';

/**
 * The canvas host.
 *
 * React's only jobs here are to own the element and to start and stop the
 * loop. The world lives in a ref and is mutated in place; buildings are not
 * components and game state is not React state, because the alternative is a
 * reconciler pass every frame for a scene that is already being drawn
 * imperatively.
 */

export interface GameCanvasProps {
  events: WorldEvents;
  /** Handed the world once, so the HUD can drive it. */
  onReady: (world: World) => void;
  onTapBuilding: (buildingId: string | null) => void;
}

export function GameCanvas({ events, onReady, onTapBuilding }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);
  // Held in a ref so the loop always calls the current handlers without the
  // effect having to tear down and restart on every parent render.
  const eventsRef = useRef(events);
  const tapRef = useRef(onTapBuilding);
  eventsRef.current = events;
  tapRef.current = onTapBuilding;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const forward: WorldEvents = {
      onSelect: (id) => eventsRef.current.onSelect(id),
      onModeChange: (m) => eventsRef.current.onModeChange(m),
      onToast: (m) => eventsRef.current.onToast(m),
      onPlayerChanged: () => eventsRef.current.onPlayerChanged(),
      onBattleEnd: (c: DeployCommand[], items: ItemCommand[]) => eventsRef.current.onBattleEnd(c, items),
      onPlacementChanged: () => eventsRef.current.onPlacementChanged(),
      onPlacementCommit: () => eventsRef.current.onPlacementCommit(),
      onCameraMoved: () => eventsRef.current.onCameraMoved(),
    };

    const world = createWorld(forward);
    worldRef.current = world;
    const onResize = (): void => resizeWorld(world, canvas, ctx);
    // Before onReady, which is where the saved graphics quality is applied and
    // that has to be able to re-size the backing store.
    world.resize = onResize;
    resizeWorld(world, canvas, ctx);
    onReady(world);

    /*
     * The hour, set when it turns rather than read every frame: a clock that
     * answers the same four ways all day has no business being asked sixty
     * times a second. The crossfade out of the old phase is what the loop
     * advances, not the phase itself.
     */
    const unwatchSky = watchPhase((phase) => setPhase(world, phase));

    const input = attachInput(world, canvas, (id) => tapRef.current(id));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      /*
       * Two clocks, and they are not the same clock.
       *
       * Everything the eye follows — the walk cycle, a flash, a puff of smoke —
       * is stepped by a delta clamped to 50 ms, so coming back to a hidden tab
       * does not teleport it. The battle is not one of those things. It runs on
       * a timer the player can see in the corner, and clamping its delta was
       * the reason a raid stopped dead the moment the window lost focus: two
       * minutes away advanced it by a twentieth of a second. It gets the real
       * elapsed time and catches up; `stepBattle` is what paces that.
       */
      const elapsed = (now - last) / 1000;
      const dt = Math.min(elapsed, 0.05);
      last = now;
      world.t += dt;
      world.now = Date.now();

      if (world.mode === 'battle') {
        stepBattle(world, elapsed);
      } else {
        predictProduction(world, dt);
      }
      decayFx(world, dt);
      stepSky(world, dt);
      renderFrame(world, ctx);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unwatchSky();
      input.detach();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      worldRef.current = null;
    };
    // Mount once. Handlers are reached through refs so they stay current
    // without restarting the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="field" aria-label="IRONVOW battlefield" />
      {/* A soft darkening at the edges of the screen, on the compositor rather
          than the canvas, so it costs no frame time at all. */}
      <div className="vignette" aria-hidden />
    </>
  );
}
