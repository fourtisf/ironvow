import { TYPES, type BuildingType } from '@ironvow/config';
import { isoX, isoY, w2s, type Camera, type Viewport } from './camera';

/**
 * Two liveries for the same structures.
 *
 * ALFA: "bangunanya juga harus berbeda" — the buildings over the water have to
 * look like they belong there, not like the home base with the lights turned
 * down.
 *
 * The honest description of what this is: a livery, not a second set of
 * models. Every night structure has the same silhouette as its daytime twin
 * plus a lantern, painted in cold stone instead of warm. Carving a genuinely
 * separate castle, forge and rampart for the night world is an art job an
 * order of magnitude larger than this file, and it can be done later without
 * touching anything here — the seam is already in the right place, because the
 * livery is part of the sprite key.
 *
 * That seam is the whole reason this is worth doing this way. The livery is
 * baked into the cached bitmap at rasterisation time, so a night base costs a
 * day base: the recolour happens once per (type, level, zoom), not once per
 * building per frame. It is safe to bake because a livery, unlike the hour,
 * never changes while a sprite is alive — the night world is always night.
 */

export const LIVERIES = ['day', 'night'] as const;
export type Livery = (typeof LIVERIES)[number];

/*
 * Moonlight on stone: cold, and no heavier than it has to be.
 *
 * The first pass was tuned on a five-building starting hold, where a heavy
 * wash reads as atmosphere. On a finished base — four hundred structures
 * inside three hundred and twenty ramparts — the same wash flattened thatch,
 * stone and gilding into one navy mass, and the night sky is painted over all
 * of it afterwards. Less tint and a wider top-to-bottom range keeps the roofs
 * telling one building from another, which is the whole job of the art.
 */
const COLD = 'rgba(46, 62, 116, 0.30)';
/** Lit from above by the moon, dark at the footings. */
const SHEEN_TOP = 'rgba(168, 202, 255, 0.30)';
const SHEEN_BOTTOM = 'rgba(6, 10, 30, 0.42)';

/**
 * Ramparts and traps carry no lantern.
 *
 * A maxed base has hundreds of rampart segments. A lamp on each would be a
 * wall of fireflies rather than a wall, and traps are meant not to be seen.
 */
const NO_LANTERN = new Set<BuildingType>(['wall', 'spike', 'snare']);

/**
 * Recolour whatever the body painter just drew, then hang a light on it.
 *
 * `source-atop` is the important part: it paints only where the sprite already
 * has ink, so the cold wash lands on the building and not on the transparent
 * box around it. That keeps the measured bounds identical to the daytime
 * shape, which is what lets the two liveries share every layout rule.
 */
export function paintNightLivery(
  ctx: CanvasRenderingContext2D, k: number, type: BuildingType,
): void {
  const c = ctx.canvas;

  ctx.save();
  // Canvas space, not world space: the wash has to cover the bitmap exactly,
  // and the painter's transform is aimed at the building's anchor.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = COLD;
  ctx.fillRect(0, 0, c.width, c.height);

  const sheen = ctx.createLinearGradient(0, 0, 0, c.height);
  sheen.addColorStop(0, SHEEN_TOP);
  sheen.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  sheen.addColorStop(1, SHEEN_BOTTOM);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();

  if (NO_LANTERN.has(type)) return;

  // Drawn after the wash and over the top of it, because a lantern that got
  // washed cold would be a lantern that is not lit.
  const s = TYPES[type].s;
  const cam: Camera = { x: 0, y: 0, z: k, tz: k };
  // `w2s` does not read the pixel ratio, and the painter's transform already
  // carries it, so this viewport only has to exist.
  const vp: Viewport = { w: 0, h: 0, dpr: 1 };
  const [px, py] = w2s(cam, vp, isoX(s - 0.12, s - 0.12), isoY(s - 0.12, s - 0.12));

  const postH = (16 + s * 5) * k;
  const r = Math.max(1.8, (3 + s * 0.7) * k);

  ctx.save();
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = Math.max(1, 1.6 * k);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - postH);
  ctx.stroke();

  // The halo first, so the flame sits inside its own light rather than on top
  // of a ring of it.
  const gy = py - postH - r;
  /*
   * Bright, and brighter than it looks like it needs to be here.
   *
   * The night sky is painted over the whole field after every sprite has been
   * blitted, so anything baked into a sprite is dimmed by it. A lantern tuned
   * to look right on this canvas is a lantern that is not there on the field.
   */
  const halo = ctx.createRadialGradient(px, gy, 0, px, gy, r * 4.2);
  halo.addColorStop(0, 'rgba(255, 186, 96, 0.52)');
  halo.addColorStop(0.4, 'rgba(255, 158, 62, 0.24)');
  halo.addColorStop(1, 'rgba(255, 140, 50, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(px, gy, r * 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#fff0c2';
  ctx.strokeStyle = '#2a2016';
  ctx.lineWidth = Math.max(0.9, 1.2 * k);
  ctx.beginPath();
  ctx.arc(px, gy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
