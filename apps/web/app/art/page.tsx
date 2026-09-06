'use client';

import { TYPES, type BuildingType } from '@ironvow/config';
import { useEffect, useRef } from 'react';
import { newCamera, type Viewport } from '../../lib/render/camera';
import { drawBuilding } from '../../lib/render/buildings';
import { C } from '../../lib/render/palette';

/**
 * Every building, at every tier, on one page.
 *
 * The art is procedural and varies with level, which means the only way to
 * see whether a level-6 Gold Mine actually reads as a bigger level-3 one is
 * to put them side by side. Doing that by playing to level 6 is not a way to
 * work, so this draws the lot: types down the page, levels across it.
 *
 * Not linked from anywhere and not part of the game — it is the workbench.
 */

const LEVELS = [1, 3, 6, 9];
const SHOWN: BuildingType[] = [
  'mine', 'forge', 'store', 'keep', 'barr', 'lab', 'cannon', 'tower', 'wall',
];

const CELL = 300;
const ROW = 420;

export default function ArtPage() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = CELL * LEVELS.length + 120;
    const h = ROW * SHOWN.length + 40;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, w, h);

    const cam = newCamera();
    const vp: Viewport = { w, h, dpr };

    SHOWN.forEach((type, row) => {
      LEVELS.forEach((level, col) => {
        // One camera per cell: the building is drawn at the grid origin and
        // the camera is moved to put it where the cell is.
        const size = TYPES[type].s;
        cam.z = 1.5;
        cam.x = -(120 + col * CELL + CELL / 2 - w / 2) / cam.z;
        cam.y = -(30 + row * ROW + ROW / 2 - h / 2) / cam.z + (size * 16);
        drawBuilding({ ctx, cam, vp, t: 0 }, { type, gx: -size / 2, gy: -size / 2, level }, false);
      });

      ctx.fillStyle = C.parch;
      ctx.font = '700 15px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(TYPES[type].n.toUpperCase(), 14, 30 + row * ROW + ROW / 2);
    });

    ctx.fillStyle = C.parch;
    ctx.font = '900 14px Arial';
    ctx.textAlign = 'center';
    LEVELS.forEach((level, col) => {
      ctx.fillText(`LEVEL ${level}`, 120 + col * CELL + CELL / 2, 26);
    });
  }, []);

  return (
    <div style={{ padding: 20, overflow: 'auto', height: '100vh', background: '#141d2b' }}>
      <canvas ref={ref} />
    </div>
  );
}
