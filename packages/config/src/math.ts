/**
 * Deterministic arithmetic.
 *
 * Every number that both the client and the server compute has to come out
 * bit-identical, or the shared simulation in @ironvow/sim diverges and the
 * server silently overrules a battle the player watched themselves win.
 *
 * IEEE-754 pins down +, -, *, / and sqrt: those are correctly rounded and
 * therefore identical on every engine. It says nothing about pow, hypot, sin,
 * cos or atan2, which are library routines and genuinely differ between V8,
 * JavaScriptCore and SpiderMonkey. So none of them appear anywhere on a path
 * that can change a result. The helpers below are the replacements.
 */

/** x^n for non-negative integer n, by repeated multiplication. Replaces Math.pow. */
export function ipow(x: number, n: number): number {
  let out = 1;
  for (let k = 0; k < n; k++) out *= x;
  return out;
}

/** Squared distance. Preferred wherever a comparison is all that is needed. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Euclidean distance via sqrt, which IEEE-754 requires to be correctly rounded. Replaces Math.hypot. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Move (x, y) toward (tx, ty) by `step` world units.
 *
 * The prototype did this with atan2 + cos/sin. Normalising the delta vector is
 * the same movement with only IEEE-exact operations, so it survives the
 * client/server determinism test.
 */
export function stepToward(
  x: number, y: number, tx: number, ty: number, step: number,
): { x: number; y: number } {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0 || len <= step) return { x: tx, y: ty };
  const k = step / len;
  return { x: x + dx * k, y: y + dy * k };
}

/**
 * Which way a unit faces on screen: +1 when it is moving toward the lower-right
 * of the iso diamond. The prototype tested `cos(a) - sin(a) > 0`, which for a
 * unit vector is just `dx - dy > 0`.
 */
export function facingOf(dx: number, dy: number): 1 | -1 {
  return dx - dy > 0 ? 1 : -1;
}
