import { DEF_STAT, TROOP, TROOP_TYPES, TROOP_UNLOCK, coversAir, flies, hitsAir } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { drawUnitUncached } from '../lib/render/units';
import { newCamera, type Viewport } from '../lib/render/camera';
import type { Draw } from '../lib/render/primitives';

/**
 * The air layer, client-side.
 *
 * The simulation decides whether a Cannon can reach a Bomber. What the client
 * owes the player is the one thing that makes that decision legible: a flyer
 * has to look like it is off the ground. Without it a Bomber crossing a wall
 * looks exactly like a Climber going over one, and the player has no way to see
 * why half their base is not firing.
 */

function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const methods = [
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse',
    'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'save', 'restore',
    'translate', 'rotate', 'scale', 'setTransform', 'drawImage', 'clip',
  ];
  const fmt = (a: unknown): string => (typeof a === 'number' ? a.toFixed(3) : String(a));
  const target: Record<string, unknown> = {};
  for (const name of methods) {
    target[name] = (...args: unknown[]): void => {
      log.push(`${name}(${args.map(fmt).join(',')})`);
    };
  }
  const ctx = new Proxy(target, {
    set(obj, key, value) { obj[String(key)] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

function paint(type: 'bomber' | 'raider', fly: boolean, t = 0): string[] {
  const { ctx, log } = recorder();
  const cam = newCamera();
  const vp: Viewport = { w: 400, h: 800, dpr: 2 };
  const d: Draw = { ctx, cam, vp, t };
  drawUnitUncached(d, {
    type, x: 20, y: 20, mine: true, hp: 1, maxHp: 1, moving: false,
    face: 1, swing: 0, flash: 0, born: 0, level: 5, fly,
  });
  return log;
}

/**
 * Where the body was placed on screen.
 *
 * The *first* translate, not the smallest. Painters translate again inside
 * themselves to position a weapon or a wing, and those are relative offsets the
 * recorder logs raw — so the minimum over all of them is some blade's local
 * coordinate and has nothing to do with the unit's height.
 */
function bodyY(log: string[]): number {
  const first = log.find((l) => l.startsWith('translate('));
  expect(first, 'the painter placed the body').toBeDefined();
  return Number(first!.slice('translate('.length, -1).split(',')[1]);
}

describe('a flyer is drawn off the ground', () => {
  it('paints its body higher than the same unit on foot', () => {
    // The body is translated to `ay`, which is where the lift is applied.
    const air = bodyY(paint('bomber', true));
    const foot = bodyY(paint('bomber', false));
    expect(air).toBeLessThan(foot);
  });

  it('leaves the shadow and the ring on the ground where the unit really is', () => {
    /*
     * The simulation has the unit at (x, y) and every range check is made from
     * there. Lifting the ring with the body would draw a unit standing on an
     * invisible floor, and a player judging whether a Bomber is inside an Air
     * Defence would be reading the wrong spot.
     */
    const air = paint('bomber', true);
    const foot = paint('bomber', false);
    const ring = (log: string[]) => log.filter((l) => l.startsWith('ellipse(')).slice(0, 2);
    expect(ring(air).map((l) => l.split(',')[1])).toEqual(ring(foot).map((l) => l.split(',')[1]));
  });

  it('hovers, and the hover is the only thing on it that reads the clock', () => {
    // The hover moves the whole cached sprite, exactly as the Ram's lunge does.
    // A painter that read the clock would bake one frame into every Bomber.
    expect(bodyY(paint('bomber', true, 0))).not.toBe(bodyY(paint('bomber', true, 3.7)));
    expect(bodyY(paint('bomber', false, 0))).toBe(bodyY(paint('bomber', false, 3.7)));
  });

  it('does not lift anything that walks', () => {
    expect(bodyY(paint('raider', false))).toBe(bodyY(paint('raider', false, 55)));
  });
});

describe('the rules a player has to be able to read off the base', () => {
  it('names exactly one flyer, and one gun built for it', () => {
    expect(TROOP_TYPES.filter(flies)).toEqual(['bomber']);
    expect(coversAir('airdef')).toBe(true);
    expect(coversAir('tower')).toBe(true);
    expect(coversAir('cannon')).toBe(false);
    expect(coversAir('mortar')).toBe(false);
  });

  it('gives the Archer the only bow in the warband that points up', () => {
    expect(TROOP_TYPES.filter(hitsAir)).toEqual(['archer']);
  });

  it('opens the answer no later than the question', () => {
    expect(TROOP_UNLOCK.bomber).toBe(5);
  });

  it('makes the flyer a commitment rather than a sixth option', () => {
    expect(TROOP.bomber.sp).toBe(TROOP.ram.sp);
    expect(DEF_STAT.airdef!(1).hits).toBe('air');
  });
});
