import { APRON, IN0, IN1, N, TERRAIN_SEED, TH, TW } from '@ironvow/config';
import { mulberry } from '@ironvow/sim';
import { isoX, isoY, visibleGrid, w2s } from './camera';
import type { Deco, GroundKind, TreelineKind } from './deco';
import { C } from './palette';
import type { Corner, Draw } from './primitives';
import { blitDeco } from './sprites';
import { drawLakes, generateLakes, inLake, type Lake } from './water';

export type { Deco, DecoKind } from './deco';

/**
 * The field and its surround.
 *
 * The buildable plateau stands a cliff's height above the apron around it, the
 * way every base of this kind does, so the eye finds the edge of the hold
 * without a line being drawn for it. The apron is deliberately deep: it is what
 * guarantees the flat backdrop can never enter frame, whatever the camera clamp
 * does at a corner.
 */

export interface Terrain {
  tile: Uint8Array;
  /** Trees, rocks and bushes on the apron. Depth-sorted with the buildings. */
  deco: Deco[];
  /** Tufts, flowers and pebbles on the field. Flat, drawn under everything. */
  ground: Deco[];
  /** Pools on the apron. */
  lakes: Lake[];
}

/** Height of the cliff face, in screen px at zoom 1. */
export const CLIFF = 22;

/** Generated from a fixed seed, so every client draws the same map. */
export function generateTerrain(): Terrain {
  const r = mulberry(TERRAIN_SEED);
  const tile = new Uint8Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const outside = gx < IN0 || gy < IN0 || gx >= IN1 || gy >= IN1;
      tile[gy * N + gx] = outside ? 1 : 0;
    }
  }

  // The treeline: over the apron only, never over buildable ground, and
  // thickest right at the foot of the cliff so the plateau reads as cleared
  // out of a forest rather than dropped onto a lawn.
  const lakes = generateLakes(r);

  const deco: Deco[] = [];
  for (let i = 0; i < 900; i++) {
    const edge = Math.floor(r() * 4);
    const along = r() * (N + APRON);
    // Two in three crowd the edge (squared, so the density falls off with
    // distance); the rest are spread evenly so the forest goes on to the
    // horizon instead of stopping at a band. The two front edges start a tile
    // further out, below the cliff face rather than standing on it.
    const front = edge === 1 || edge === 3;
    const spread = i % 3 === 0 ? r() : r() * r();
    const depth = (front ? 2.2 : 0.8) + spread * (APRON - 3);
    let gx: number;
    let gy: number;
    if (edge === 0) { gx = along - APRON / 2; gy = -depth; }
    else if (edge === 1) { gx = along - APRON / 2; gy = N + depth; }
    else if (edge === 2) { gx = -depth; gy = along - APRON / 2; }
    else { gx = N + depth; gy = along - APRON / 2; }
    // Nothing grows in the water, and the wet sand round it stays clear too.
    if (inLake(lakes, gx, gy, 1.3)) continue;

    const roll = r();
    const k: TreelineKind =
      roll < 0.46 ? 'tree' : roll < 0.74 ? 'pine' : roll < 0.86 ? 'rock' : roll < 0.96 ? 'bush' : 'stump';
    deco.push({ gx, gy, k, s: 0.7 + r() * 0.55, p: r() * 6.28, v: r() < 0.3 ? 1 : 0 });
  }
  // The ring between the buildable square and the cliff edge is the hold's
  // own ground, and it gets bushes and boulders of its own: the plateau's rim
  // reads as a rim, and the ring stops looking like a margin nobody drew on.
  for (let i = 0; i < 90; i++) {
    const along = 0.4 + r() * (N - 0.8);
    const inset = 0.35 + r() * (IN0 - 0.7);
    const side = Math.floor(r() * 4);
    const gx = side === 0 ? inset : side === 1 ? N - inset : along;
    const gy = side === 2 ? inset : side === 3 ? N - inset : along;
    const roll = r();
    const k: TreelineKind = roll < 0.55 ? 'bush' : roll < 0.85 ? 'rock' : 'stump';
    deco.push({ gx, gy, k, s: 0.55 + r() * 0.5, p: 0, v: r() < 0.35 ? 1 : 0 });
  }
  deco.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));

  // Ground cover on the field. Patches first so tufts land on top of them.
  const ground: Deco[] = [];
  const scatter = (n: number, k: GroundKind, lo: number, hi: number, variants: number): void => {
    for (let i = 0; i < n; i++) {
      ground.push({
        gx: r() * N, gy: r() * N, k,
        s: lo + r() * (hi - lo), p: 0, v: Math.floor(r() * variants),
      });
    }
  };
  scatter(44, 'patch', 0.8, 1.5, 2);
  scatter(300, 'tuft', 0.7, 1.15, 2);
  scatter(110, 'flower', 0.7, 1.05, 4);
  scatter(44, 'pebble', 0.7, 1.05, 1);

  return { tile, deco, ground, lakes };
}

/* ------------------------------------------------------------- pattern --- */

/**
 * The grass is an isometric checkerboard, and it is painted with a canvas
 * pattern rather than a diamond per tile: the field is 3,136 tiles, and one
 * fill is what a 60 fps budget on a phone can afford.
 *
 * The pattern is drawn one device pixel to one, never scaled: a scaled pattern
 * fill measured at five times the cost of a plain one. That is only exact
 * because the zoom is snapped so a tile is a whole number of device pixels
 * wide (see `snapZoom`). The tile is two grid rows tall so that its height is
 * whole too, whatever the width's parity.
 */
interface GrassPattern {
  pattern: CanvasPattern;
  /** Device px, and also the height. */
  w: number;
}

const patterns = new Map<string, GrassPattern>();

function grassPattern(ctx: CanvasRenderingContext2D, z: number, dpr: number, a: string, b: string): GrassPattern {
  const w = Math.max(2, Math.round(TW * z * dpr));
  const key = `${w}|${a}|${b}`;
  const hit = patterns.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = w;
  const t = c.getContext('2d')!;
  t.fillStyle = b;
  t.fillRect(0, 0, w, w);
  t.fillStyle = a;
  // The `a` diamond of row 0, centred, and the two halves of row 1's, which
  // sit on the side edges and meet when the tile repeats.
  const h = w / 2;
  const diamond = (cx: number, cy: number): void => {
    t.moveTo(cx, cy - h / 2);
    t.lineTo(cx + w / 2, cy);
    t.lineTo(cx, cy + h / 2);
    t.lineTo(cx - w / 2, cy);
    t.closePath();
  };
  t.beginPath();
  diamond(w / 2, h / 2);
  diamond(0, h * 1.5);
  diamond(w, h * 1.5);
  t.fill();

  const made: GrassPattern = { pattern: ctx.createPattern(c, 'repeat')!, w };
  if (patterns.size > 24) patterns.delete(patterns.keys().next().value!);
  patterns.set(key, made);
  return made;
}

/**
 * Fill the current path (or, with no path, the whole screen) with grass
 * aligned to the grid.
 *
 * Tile (gx, gy) with gx + gy even is the `a` colour. Those diamonds sit on a
 * rectangular lattice with period (TW, TH) whose origin is world (-TW/2, 0),
 * which is where the pattern is anchored. The anchor lands on a whole device
 * pixel, so the fill is a straight copy; the half-pixel that costs is the same
 * placement error every sprite already accepts.
 */
function fillGrass(d: Draw, a: string, b: string, path: boolean): void {
  const { ctx, cam, vp } = d;
  const g = grassPattern(ctx, cam.z, vp.dpr, a, b);
  const [ox, oy] = w2s(cam, vp, -TW / 2, 0);
  const ax = Math.round(ox * vp.dpr);
  const ay = Math.round(oy * vp.dpr);
  ctx.save();
  // Pattern space is the context's transform at fill time. A path already
  // begun keeps its place: its points were mapped when they were added.
  ctx.setTransform(1, 0, 0, 1, ax, ay);
  ctx.fillStyle = g.pattern;
  if (path) ctx.fill();
  else ctx.fillRect(-ax, -ay, Math.ceil(vp.w * vp.dpr), Math.ceil(vp.h * vp.dpr));
  ctx.restore();
}

/* ---------------------------------------------------------------- draw --- */

function corners(d: Draw, g0: number, g1: number): [Corner, Corner, Corner, Corner] {
  const { cam, vp } = d;
  const P = (gx: number, gy: number): Corner => w2s(cam, vp, isoX(gx, gy), isoY(gx, gy));
  // Top, right, bottom, left.
  return [P(g0, g0), P(g1, g0), P(g1, g1), P(g0, g1)];
}

function diamondPath(ctx: CanvasRenderingContext2D, [T, R, B, L]: [Corner, Corner, Corner, Corner], dy = 0): void {
  ctx.beginPath();
  ctx.moveTo(T[0], T[1] + dy);
  ctx.lineTo(R[0], R[1] + dy);
  ctx.lineTo(B[0], B[1] + dy);
  ctx.lineTo(L[0], L[1] + dy);
  ctx.closePath();
}

/**
 * The plateau's two visible faces, from its left corner round the bottom to
 * its right, with a lip of turf along the top and the strata of the cut earth
 * below. Lit like the buildings: the south-west face in shadow, the south-east
 * face catching the light.
 */
function drawCliff(d: Draw, c: [Corner, Corner, Corner, Corner]): void {
  const { ctx, cam } = d;
  const z = cam.z;
  const H = CLIFF * z;
  const [, R, B, L] = c;

  // Shadow thrown on the apron at the foot of the cliff.
  ctx.fillStyle = 'rgba(16,36,14,.22)';
  ctx.beginPath();
  ctx.moveTo(L[0], L[1] + H);
  ctx.lineTo(B[0], B[1] + H);
  ctx.lineTo(R[0], R[1] + H);
  ctx.lineTo(R[0] + 6 * z, R[1] + H + 9 * z);
  ctx.lineTo(B[0], B[1] + H + 14 * z);
  ctx.lineTo(L[0] - 6 * z, L[1] + H + 9 * z);
  ctx.closePath();
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, 2.2 * z);
  ctx.strokeStyle = C.line;

  const face = (p: Corner, q: Corner, earth: string, strata: string): void => {
    ctx.fillStyle = earth;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    ctx.lineTo(q[0], q[1] + H); ctx.lineTo(p[0], p[1] + H);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Two seams of darker earth, wandering rather than ruled, a scatter of
    // buried stones and a darker foot. Cheap, and it is what stops the face
    // from reading as a stack of planks.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    ctx.lineTo(q[0], q[1] + H); ctx.lineTo(p[0], p[1] + H);
    ctx.closePath(); ctx.clip();
    const at = (f: number, dy: number): Corner => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f + H * dy];
    const SEG = 14;
    const wobble = (i: number, salt: number): number => (((i * 37 + salt * 11) % 7) - 3) * 0.018;
    ctx.fillStyle = strata;
    for (const [y0, h, salt] of [[0.4, 0.09, 1], [0.7, 0.07, 2]] as const) {
      ctx.beginPath();
      for (let i = 0; i <= SEG; i++) {
        const [x, y] = at(i / SEG, y0 + wobble(i, salt));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = SEG; i >= 0; i--) {
        const [x, y] = at(i / SEG, y0 + h + wobble(i, salt + 1));
        ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,14,8,.22)';
    ctx.beginPath();
    ctx.moveTo(p[0], p[1] + H * 0.8); ctx.lineTo(q[0], q[1] + H * 0.8);
    ctx.lineTo(q[0], q[1] + H); ctx.lineTo(p[0], p[1] + H);
    ctx.closePath(); ctx.fill();
    // A stone every tile or two along the face.
    const n = Math.round(N * 0.7);
    for (let i = 1; i < n; i++) {
      const [x, y] = at(i / n + wobble(i, 5) * 0.4, 0.22 + ((i * 7) % 5) * 0.11);
      const rx = (2.4 + ((i * 3) % 3) * 0.9) * z;
      ctx.fillStyle = C.stone;
      ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.62, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = C.stoneL;
      ctx.beginPath(); ctx.ellipse(x - rx * 0.25, y - rx * 0.25, rx * 0.45, rx * 0.25, 0, 0, 6.29); ctx.fill();
    }
    ctx.restore();

    // The turf overhangs the cut by a little.
    ctx.fillStyle = C.grassLip;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    ctx.lineTo(q[0], q[1] + 4 * z); ctx.lineTo(p[0], p[1] + 4 * z);
    ctx.closePath(); ctx.fill();
  };
  face(L, B, C.earthD, '#4b3a26');
  face(B, R, C.earth, '#5c4630');

  // The seam where the two faces meet, and the edge of the turf.
  ctx.beginPath(); ctx.moveTo(B[0], B[1]); ctx.lineTo(B[0], B[1] + H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L[0], L[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(R[0], R[1]); ctx.stroke();
}

/** Paint the ground: the field, the apron, the cliff and the ground cover. */
export function drawTerrain(d: Draw, ter: Terrain): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;

  // Almost always the field alone covers the screen, and then the apron, the
  // cliff and the clip are all skipped: one pattern fill does the whole job.
  // `visibleGrid` already carries a 120 px margin, which is more than the
  // cliff hangs below the field's edge at any zoom.
  const v = visibleGrid(cam, vp);
  const covered = v[0] >= 0 && v[1] <= N && v[2] >= 0 && v[3] <= N;
  const field = corners(d, 0, N);

  if (covered) {
    fillGrass(d, C.grass, C.grassB, false);
  } else {
    // The apron, lower and a shade darker, out to the edge of the world.
    fillGrass(d, C.apron, C.apronB, false);
    drawLakes(d, ter.lakes);
    drawCliff(d, field);
    diamondPath(ctx, field);
    fillGrass(d, C.grass, C.grassB, true);
  }

  {
    for (const g of ter.ground) blitDeco(d, g);
  }

  // The buildable bound, a shade darker than the grass, and only that: the
  // edge of the hold is already the cliff.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = Math.max(1.2, 1.8 * z);
  ctx.strokeStyle = '#4d7f33';
  diamondPath(ctx, corners(d, IN0, IN1));
  ctx.stroke();
  ctx.restore();
}
