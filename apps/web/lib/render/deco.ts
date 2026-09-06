import { C } from './palette';
import { roundRect } from './primitives';

/**
 * Scenery painters.
 *
 * Two families. The *treeline* kinds stand up and take part in the depth sort
 * with the buildings; the *ground* kinds lie flat on the field and are painted
 * straight after the grass, under everything, so a building placed on top of a
 * tuft simply hides it.
 *
 * Each painter draws at the origin in screen space at a given scale, which is
 * what lets the sprite cache rasterise it once and blit it from then on.
 */

export type TreelineKind = 'tree' | 'pine' | 'rock' | 'bush' | 'stump';
export type GroundKind = 'patch' | 'tuft' | 'flower' | 'pebble';
export type DecoKind = TreelineKind | GroundKind;

export interface Deco {
  gx: number;
  gy: number;
  k: DecoKind;
  s: number;
  /** Phase offset so neighbouring trees do not sway in lockstep. */
  p: number;
  /** Colour or shape variant, part of the sprite key. */
  v: number;
}

export const hasCanopy = (k: DecoKind): boolean => k === 'tree' || k === 'pine';

const FLOWER = ['#f6f1dc', '#f2d24a', '#e77a8e', '#a7c6f0'] as const;

function outline(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.3, 2.2 * s);
  ctx.strokeStyle = C.line;
}

export function paintDecoBase(ctx: CanvasRenderingContext2D, kind: DecoKind, s: number, v: number): void {
  outline(ctx, s);

  switch (kind) {
    case 'tree':
    case 'pine': {
      ctx.fillStyle = 'rgba(20,40,18,.24)';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 11 * s, 5 * s, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = C.woodD;
      roundRect(ctx, -2.6 * s, -16 * s, 5.2 * s, 17 * s, 2 * s);
      ctx.fill(); ctx.stroke();
      return;
    }
    case 'rock': {
      ctx.fillStyle = 'rgba(20,40,18,.22)';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 10 * s, 4.5 * s, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = C.stone;
      ctx.beginPath();
      ctx.moveTo(-9 * s, 0);
      ctx.lineTo(-5 * s, -9 * s);
      ctx.lineTo(3 * s, -11 * s);
      ctx.lineTo(9 * s, -3 * s);
      ctx.lineTo(6 * s, s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.stoneL;
      ctx.beginPath();
      ctx.moveTo(-5 * s, -9 * s);
      ctx.lineTo(3 * s, -11 * s);
      ctx.lineTo(s, -6 * s);
      ctx.closePath(); ctx.fill();
      return;
    }
    case 'bush': {
      ctx.fillStyle = 'rgba(20,40,18,.18)';
      ctx.beginPath(); ctx.ellipse(0, s, 10 * s, 4 * s, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#3f8a41';
      ctx.beginPath(); ctx.ellipse(0, -5 * s, 9 * s, 7 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#54a84f';
      ctx.beginPath(); ctx.ellipse(-2 * s, -8 * s, 5 * s, 4 * s, 0, 0, 6.29); ctx.fill();
      if (v === 1) {
        // A berry bush, now and then.
        ctx.fillStyle = C.blood;
        for (const [x, y] of [[-5, -3], [3, -8], [5, -2]] as const) {
          ctx.beginPath(); ctx.arc(x * s, y * s, 1.4 * s, 0, 6.29); ctx.fill();
        }
      }
      return;
    }
    case 'stump': {
      ctx.fillStyle = 'rgba(20,40,18,.2)';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 8 * s, 3.5 * s, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = C.woodD;
      ctx.beginPath();
      ctx.moveTo(-5 * s, -6 * s); ctx.lineTo(5 * s, -6 * s); ctx.lineTo(6 * s, 1 * s); ctx.lineTo(-6 * s, 1 * s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.dirt;
      ctx.beginPath(); ctx.ellipse(0, -6 * s, 5.5 * s, 2.6 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = C.dirt2;
      ctx.lineWidth = Math.max(0.8, 1 * s);
      ctx.beginPath(); ctx.ellipse(0, -6 * s, 2.6 * s, 1.2 * s, 0, 0, 6.29); ctx.stroke();
      return;
    }

    /* ---------------------------------------------------------- ground --- */
    case 'patch': {
      // A soft mottle of darker or lighter turf, two to three tiles across.
      // No outline: it is meant to be read as light, not as an object.
      ctx.fillStyle = v === 0 ? 'rgba(46,92,30,.11)' : 'rgba(200,236,130,.09)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 46 * s, 23 * s, 0, 0, 6.29);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(18 * s, 6 * s, 30 * s, 16 * s, 0, 0, 6.29);
      ctx.fill();
      return;
    }
    case 'tuft': {
      // Five blades leaning with the same wind the canopies sway to.
      ctx.strokeStyle = v === 0 ? '#4f8a33' : '#8fcf5a';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.9, 1.5 * s);
      const blades = [[-4, -7, -1.5], [-1.5, -9.5, -0.5], [1, -8.5, 0.5], [3.5, -6.5, 1.2], [-2.5, -5, -3]] as const;
      for (const [tx, ty, bx] of blades) {
        ctx.beginPath();
        ctx.moveTo(bx * s, 0);
        ctx.quadraticCurveTo(bx * s, -3 * s, tx * s, ty * s);
        ctx.stroke();
      }
      return;
    }
    case 'flower': {
      ctx.strokeStyle = '#4f8a33';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.9, 1.4 * s);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -5 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4 * s, 1 * s); ctx.lineTo(4.5 * s, -3 * s); ctx.stroke();
      ctx.fillStyle = FLOWER[v % FLOWER.length]!;
      ctx.beginPath(); ctx.arc(0, -6 * s, 2.2 * s, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(4.5 * s, -4 * s, 1.6 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(-0.7 * s, -6.7 * s, 0.8 * s, 0, 6.29); ctx.fill();
      return;
    }
    case 'pebble': {
      // A lighter outline than the rest: at the far zoom a dark ring on a
      // pebble reads as a speck of dirt on the screen.
      ctx.lineWidth = Math.max(0.8, 1.1 * s);
      ctx.strokeStyle = C.stoneD;
      ctx.fillStyle = C.stone;
      ctx.beginPath(); ctx.ellipse(-3 * s, 0, 3.6 * s, 2.2 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(3.5 * s, 1 * s, 2.4 * s, 1.6 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.stoneL;
      ctx.beginPath(); ctx.ellipse(-3.6 * s, -0.7 * s, 1.8 * s, 0.9 * s, 0, 0, 6.29); ctx.fill();
      return;
    }
  }
}

/** A tree's canopy, which sways independently of its trunk. */
export function paintDecoCanopy(ctx: CanvasRenderingContext2D, kind: DecoKind, s: number): void {
  outline(ctx, s);
  if (kind === 'pine') {
    // Three tiers, each a little narrower, in a deeper green than the round
    // trees so a treeline reads as a mix rather than a row of the same tree.
    const tiers = [[-14, 15, 12], [-24, 12, 11], [-33, 8.5, 10]] as const;
    for (const [top, half, h] of tiers) {
      ctx.fillStyle = C.forest;
      ctx.beginPath();
      ctx.moveTo(-half * s, (top + h) * s);
      ctx.lineTo(0, top * s);
      ctx.lineTo(half * s, (top + h) * s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3d7a44';
      ctx.beginPath();
      ctx.moveTo(-half * 0.55 * s, (top + h * 0.85) * s);
      ctx.lineTo(-half * 0.1 * s, (top + h * 0.25) * s);
      ctx.lineTo(-half * 0.2 * s, (top + h * 0.85) * s);
      ctx.closePath(); ctx.fill();
    }
    return;
  }
  ctx.fillStyle = '#3f8a41';
  ctx.beginPath(); ctx.ellipse(0, -26 * s, 14 * s, 12 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#54a84f';
  ctx.beginPath(); ctx.ellipse(-3 * s, -30 * s, 8 * s, 6.5 * s, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.beginPath(); ctx.ellipse(-5 * s, -32 * s, 3.5 * s, 2.5 * s, 0, 0, 6.29); ctx.fill();
}
