/**
 * World geometry. Ported verbatim from IRONVOW_v0.6.html.
 *
 * The buildable field is the inner 52 x 52 of a 56 x 56 grid. The two-cell
 * apron on every side is what stops the camera clamp from ever showing the
 * backdrop (prototype bug #5).
 */

/** Iso tile width / height in world units at zoom 1. */
export const TW = 64;
export const TH = 32;

/** Full terrain grid. */
export const N = 56;

/** Buildable inner bounds: IN0 <= gx, gx + size <= IN1. 52 x 52 = 2704 cells. */
export const IN0 = 2;
export const IN1 = N - 2;

/** Buildable cell count, asserted by tests so a grid change cannot pass silently. */
export const BUILDABLE_CELLS = (IN1 - IN0) * (IN1 - IN0);

/** Highest Keep level. Nothing may ever exceed the Keep's level. */
export const KEEP_MAX = 9;

/** Deep-forest surround, sized so the flat backdrop can never enter frame. */
export const APRON = 26;

/** Terrain is generated from this fixed seed so every client draws the same map. */
export const TERRAIN_SEED = 20260905;

/** Camera limits. */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.9;

/** Client render cap. Uncapped DPR on high-density Android is the biggest frame-rate risk. */
export const MAX_DPR = 2;
