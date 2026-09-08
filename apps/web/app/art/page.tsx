'use client';

import { TROOP, TYPES, type BuildingType } from '@ironvow/config';
import type { DeployableType } from '@ironvow/types';
import { useEffect, useRef } from 'react';
import { newCamera, type Viewport } from '../../lib/render/camera';
import { drawBuilding } from '../../lib/render/buildings';
import { drawUnit } from '../../lib/render/units';
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
  'mine', 'forge', 'store', 'keep', 'barr', 'camp', 'lab', 'cannon', 'tower', 'mortar', 'wall',
];
const TROOPS: DeployableType[] = ['raider', 'archer', 'lancer', 'scaler', 'ram', 'hero'];

const CELL = 300;
const ROW = 420;

export default function ArtPage() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  /*
   * The bench: `/art#bench`.
   *
   * Troops are the only art in the game with a per-frame cost that scales with
   * how well the game is going — a full warband is twenty-eight figures — and
   * measuring that inside a real raid is useless, because the opponent, the
   * unit count and how far the fight has got all differ between runs. This
   * draws a fixed twenty-eight at a fixed scale and reports the frame times on
   * `window.BENCH`, which is what a throttled headless run reads.
   *
   * It is how the kit was found to cost 83 ms a frame at 4x before it was
   * cached and 33 ms after.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#bench') return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = 2;
    canvas.width = 412 * dpr; canvas.height = 892 * dpr;
    canvas.style.width = '412px'; canvas.style.height = '892px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = newCamera(); cam.z = 1; cam.x = 0; cam.y = 0;
    const vp = { w: 412, h: 892, dpr };
    const N = 28;
    const units = Array.from({ length: N }, (_, i) => ({
      type: (['raider','archer','lancer','scaler','ram'] as const)[i % 5]!,
      x: -4 + (i % 7) * 1.2, y: -4 + Math.floor(i / 7) * 1.2,
      mine: true, hp: 1, maxHp: 1, moving: true, face: (i % 2 ? 1 : -1) as 1 | -1,
      swing: 0.3, flash: 0, born: i * 0.13, level: 9,
    }));
    const times: number[] = [];
    let last = performance.now();
    let n = 0;
    const tick = (now: number) => {
      times.push(now - last); last = now;
      ctx.fillStyle = '#6ea844'; ctx.fillRect(0, 0, 412, 892);
      for (const u of units) drawUnit({ ctx, cam, vp, t: now / 1000 }, u);
      if (++n < 200) requestAnimationFrame(tick);
      else {
        const s = times.slice(2).sort((a, b) => a - b);
        (window as unknown as { BENCH: unknown }).BENCH = {
          n: N, median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)],
        };
      }
    };
    requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    // The bench above owns the canvas when it is asked for.
    if (typeof window !== 'undefined' && window.location.hash === '#bench') return;
    // The game's own stylesheet pins html and body to the viewport and hides
    // overflow, which is right for a full-screen canvas game and wrong for a
    // four-thousand-pixel contact sheet. Undone here only, and only while this
    // page is mounted.
    const html = document.documentElement;
    const prev = [html.style.height, html.style.overflow, document.body.style.height, document.body.style.overflow];
    html.style.height = 'auto'; html.style.overflow = 'visible';
    document.body.style.height = 'auto'; document.body.style.overflow = 'visible';

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = CELL * LEVELS.length + 120;
    const h = ROW * (SHOWN.length + 1 + TROOPS.length) + 40;
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

    /*
     * A run of Ramparts, which is the only shape a single one cannot show.
     * A Rampart is drawn from its neighbours, so one on its own is the least
     * representative thing on the sheet — a wall is what a player looks at.
     */
    const run: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]];
    const has = (x: number, y: number): boolean => run.some(([a, b]) => a === x && b === y);
    const row = SHOWN.length;
    LEVELS.forEach((level, col) => {
      cam.z = 1.5;
      cam.x = -(120 + col * CELL + CELL / 2 - w / 2) / cam.z;
      cam.y = -(30 + row * ROW + ROW / 2 - h / 2) / cam.z + 16;
      for (const [x, y] of run) {
        const link = (has(x + 1, y) ? 1 : 0) | (has(x, y + 1) ? 2 : 0)
          | (has(x - 1, y) ? 4 : 0) | (has(x, y - 1) ? 8 : 0);
        drawBuilding({ ctx, cam, vp, t: 0 }, { type: 'wall', gx: x - 1, gy: y - 1, level, link }, false);
      }
    });
    ctx.fillStyle = C.parch;
    ctx.font = '700 15px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('RAMPART RUN', 14, 30 + row * ROW + ROW / 2);

    /*
     * The troops, on the same grid.
     *
     * A troop's level comes from the War Lab and is the most expensive thing
     * a player buys, so "does level 6 look like more than level 3" is a
     * question that has to be answerable without playing to level 6.
     */
    TROOPS.forEach((type, k) => {
      const trow = SHOWN.length + 1 + k;
      LEVELS.forEach((level, col) => {
        cam.z = 1.5;
        cam.x = -(120 + col * CELL + CELL / 2 - w / 2) / cam.z;
        cam.y = -(30 + trow * ROW + ROW / 2 - h / 2) / cam.z;
        drawUnit({ ctx, cam, vp, t: 0 }, {
          type, x: 0, y: 0, mine: true, hp: 1, maxHp: 1,
          moving: false, face: 1, swing: 0, flash: 0, born: 0, level,
        });
      });
      ctx.fillStyle = C.parch;
      ctx.font = '700 15px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(
        (type === 'hero' ? 'VOWKEEPER' : TROOP[type].n).toUpperCase(),
        14, 30 + trow * ROW + ROW / 2,
      );
    });

    ctx.fillStyle = C.parch;
    ctx.font = '900 14px Arial';
    ctx.textAlign = 'center';
    LEVELS.forEach((level, col) => {
      ctx.fillText(`LEVEL ${level}`, 120 + col * CELL + CELL / 2, 26);
    });
    return () => {
      html.style.height = prev[0] ?? ''; html.style.overflow = prev[1] ?? '';
      document.body.style.height = prev[2] ?? ''; document.body.style.overflow = prev[3] ?? '';
    };
  }, []);

  return (
    <div style={{ padding: 20, background: '#141d2b' }}>
      <canvas ref={ref} />
    </div>
  );
}
