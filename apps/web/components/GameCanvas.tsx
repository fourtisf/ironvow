'use client';

import { useEffect, useRef } from 'react';
import type { DeployCommand } from '@ironvow/types';
import { attachInput } from '../lib/game/input';
import { renderFrame } from '../lib/game/render';
import {
  createWorld,
  decayFx,
  predictProduction,
  resizeWorld,
  stepBattle,
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
      onBattleEnd: (c: DeployCommand[]) => eventsRef.current.onBattleEnd(c),
    };

    const world = createWorld(forward);
    worldRef.current = world;
    resizeWorld(world, canvas, ctx);
    onReady(world);

    const input = attachInput(world, canvas, (id) => tapRef.current(id));
    const onResize = (): void => resizeWorld(world, canvas, ctx);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number): void => {
      // Clamp the step so a backgrounded tab does not resume with one enormous
      // delta and teleport everything.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      world.t += dt;
      world.now = Date.now();

      if (world.mode === 'battle') {
        stepBattle(world, dt);
      } else {
        predictProduction(world, dt);
      }
      decayFx(world, dt);
      renderFrame(world, ctx);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      input.detach();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      worldRef.current = null;
    };
    // Mount once. Handlers are reached through refs so they stay current
    // without restarting the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} id="field" aria-label="IRONVOW battlefield" />;
}
