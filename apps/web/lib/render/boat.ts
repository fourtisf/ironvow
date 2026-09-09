import { isoX, isoY, w2s } from './camera';
import { C } from './palette';
import type { Draw } from './primitives';
import type { Lake } from './water';

/**
 * The boat, and the way across.
 *
 * ALFA: "dunia malam tuh kaya ada laut, nah lautnya ada kapal, nah pas klik
 * kapal tiba-tiba ke dunia malam." Not a button in the corner — a thing sitting
 * in the world that you touch. Clash puts a boat on the shore for the same
 * reason: crossing between two bases should feel like going somewhere, and a
 * button in a HUD feels like changing a setting.
 *
 * It floats on the larger of the two lakes, which is the one off the south-east
 * edge in full view of the plateau. Everything about it moves on the clock, so
 * it is drawn live and never goes near the sprite cache — a boat rasterised
 * once would be a boat frozen mid-bob for the rest of the session.
 */

/** How large the hitbox is, in screen pixels at scale 1, either side of centre. */
const TAP_W = 46;
const TAP_H = 40;

/**
 * How large the boat is drawn, relative to the rest of the field.
 *
 * At the world's own scale it came out about one tile across, which on a
 * zoomed-out phone is a dozen pixels of hull in the middle of a lake — there,
 * but not something anyone would ever notice, let alone press. A ship is a
 * large object anyway, so it is drawn at a little over two tiles.
 */
const BOAT = 2.2;
/**
 * And it never shrinks past this, however far the camera pulls back.
 *
 * The one place in the renderer where something is deliberately not to scale.
 * The boat is the only way into half the game that is not a button, and an
 * affordance that vanishes at the zoom people actually play at is not an
 * affordance. It sits alone on open water, so nothing it could clip is there.
 */
const BOAT_FLOOR = 0.62;

/** The scale the boat is drawn and hit-tested at. Both must use this one. */
function boatScale(z: number): number {
  return Math.max(z, BOAT_FLOOR) * BOAT;
}

/**
 * Where it sits.
 *
 * The largest lake by area, and a little in from its centre toward the
 * plateau — a boat in the middle of the water is a boat nobody reads as
 * something to walk to.
 */
export function boatAt(lakes: readonly Lake[]): { gx: number; gy: number } | null {
  if (lakes.length === 0) return null;
  let best = lakes[0]!;
  let bestSpan = -Infinity;
  for (const l of lakes) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of l.pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const span = (x1 - x0) * (y1 - y0);
    if (span > bestSpan) { bestSpan = span; best = l; }
  }
  // Toward the near shore rather than the middle: the side of the water the
  // plateau is on is the side someone would walk down to.
  return { gx: best.cx - 3.6, gy: best.cy - 2.6 };
}

/** Screen position of the boat's middle, for drawing and for hit testing. */
export function boatScreen(d: Draw, at: { gx: number; gy: number }): [number, number] {
  return w2s(d.cam, d.vp, isoX(at.gx, at.gy), isoY(at.gx, at.gy));
}

/** Whether a tap at these screen coordinates landed on it. */
export function boatHit(d: Draw, at: { gx: number; gy: number }, sx: number, sy: number): boolean {
  const [bx, by] = boatScreen(d, at);
  const z = boatScale(d.cam.z);
  // Generous, and taller above the waterline than below: the sail is the part
  // of it a thumb actually goes for.
  return sx > bx - TAP_W * z && sx < bx + TAP_W * z
    && sy > by - TAP_H * 1.7 * z && sy < by + TAP_H * 0.5 * z;
}

/**
 * Paint it.
 *
 * `night` swaps the sail for a lit lantern, so the boat says which way it is
 * going: from a bright field it is the dark crossing, and from the night base
 * it is the way home.
 */
export function drawBoat(d: Draw, at: { gx: number; gy: number }, night: boolean): void {
  const { ctx, t } = d;
  const z = boatScale(d.cam.z);
  const [x, y0] = boatScreen(d, at);

  // Two clocks so the roll and the rise are never quite in step, which is what
  // stops it reading as a sprite on a sine wave.
  const bob = Math.sin(t * 1.15) * 3.2 * z;
  const roll = Math.sin(t * 0.83 + 1.1) * 0.045;
  const y = y0 + bob;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.2, 2 * z);

  /* --- the wake, under everything, flattened into the water --- */
  ctx.fillStyle = 'rgba(255,255,255,.13)';
  ctx.beginPath();
  ctx.ellipse(0, 7 * z, 34 * z, 9 * z, 0, 0, 6.29);
  ctx.fill();

  /* --- hull: a shallow boat seen from the same angle as everything else --- */
  ctx.fillStyle = night ? '#5a4630' : C.wood;
  ctx.beginPath();
  ctx.moveTo(-30 * z, 0);
  ctx.quadraticCurveTo(-26 * z, 11 * z, 0, 12 * z);
  ctx.quadraticCurveTo(26 * z, 11 * z, 30 * z, 0);
  ctx.quadraticCurveTo(0, 6 * z, -30 * z, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // The rail, a shade up, so the hull has a lit edge like every other surface.
  ctx.fillStyle = night ? '#7b6144' : '#a9713d';
  ctx.beginPath();
  ctx.moveTo(-30 * z, 0);
  ctx.quadraticCurveTo(0, 6 * z, 30 * z, 0);
  ctx.quadraticCurveTo(0, 1.5 * z, -30 * z, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  /* --- mast --- */
  ctx.fillStyle = C.woodD;
  ctx.fillRect(-1.6 * z, -34 * z, 3.2 * z, 36 * z);
  ctx.strokeRect(-1.6 * z, -34 * z, 3.2 * z, 36 * z);

  if (night) {
    /*
     * A lantern rather than a sail on the way home: it is the one warm thing
     * on a dark field, and it reads at a glance as the thing to press.
     */
    const swing = Math.sin(t * 1.6) * 2.4 * z;
    const lx = swing;
    const ly = -26 * z;
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 26 * z);
    glow.addColorStop(0, 'rgba(255,206,120,.6)');
    glow.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 26 * z, 0, 6.29);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.ellipse(lx, ly, 4.2 * z, 5.4 * z, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();
  } else {
    // A sail with a slack curve that breathes, so the whole thing is never
    // still even when the water is.
    const belly = 9 + Math.sin(t * 1.4) * 2.2;
    ctx.fillStyle = C.parch;
    ctx.beginPath();
    ctx.moveTo(0, -33 * z);
    ctx.quadraticCurveTo(belly * 2.4 * z, -18 * z, 0, -3 * z);
    ctx.lineTo(0, -33 * z);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(0, -33 * z);
    ctx.quadraticCurveTo(belly * 1.5 * z, -25 * z, 0, -19 * z);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
