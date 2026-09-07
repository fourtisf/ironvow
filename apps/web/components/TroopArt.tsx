'use client';

import type { DeployableType } from '@ironvow/types';
import { useEffect, useRef } from 'react';
import { newCamera, type Viewport } from '../lib/render/camera';
import { drawUnit } from '../lib/render/units';

/**
 * One troop, drawn at a given War Lab level.
 *
 * A troop upgrade is the most expensive thing a player buys and used to be the
 * least visible: a number in a row and a slightly longer health bar, with
 * nothing to look at until the next raid — and then only in a crowd of twenty,
 * mid-fight. The kit now changes with the level, so the War Lab shows it: what
 * the troop looks like today, and what the next level turns it into.
 *
 * The same `drawUnit` the battle uses, on a small canvas of its own. There is
 * no second drawing of a Raider to keep in step with the first.
 */

interface Props {
  type: DeployableType;
  level: number;
  /** CSS pixels, square. */
  size?: number;
  /** Blue livery by default; false draws the enemy's red. */
  mine?: boolean;
  /** Dimmed, for the "what the next level looks like" preview. */
  faded?: boolean;
}

export function TroopArt({ type, level, size = 56, mine = true, faded = false }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    /*
     * Fitted to the tallest thing that can be drawn, not to the average.
     *
     * A soldier is about 43 art units from boot to plume and the art is
     * drawn at twice the zoom, so 100 units of badge holds one with a margin.
     * A ram is half again as wide and has a canopy, so it gets its own
     * divisor rather than every badge being sized for the widest case.
     */
    const cam = newCamera();
    cam.z = size / (type === 'ram' ? 150 : 118);
    // The figure stands on the point the camera is aimed at, so the aim sits
    // below centre and the badge is filled rather than half empty.
    cam.y = -0.32 * size / cam.z;
    const vp: Viewport = { w: size, h: size, dpr };

    ctx.globalAlpha = faded ? 0.45 : 1;
    drawUnit({ ctx, cam, vp, t: 0 }, {
      type, x: 0, y: 0, mine, hp: 1, maxHp: 1,
      moving: false, face: 1, swing: 0, flash: 0, born: 0, level,
    });
    ctx.globalAlpha = 1;
  }, [type, level, size, mine, faded]);

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden />;
}
