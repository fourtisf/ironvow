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

/**
 * Camera limits.
 *
 * The prototype floored zoom at 0.7, which was right for it: it generated its
 * own opponents in a tight ring around the middle of the map, so a whole enemy
 * base always fitted. A real player's base can span the field, and a raider who
 * cannot see the layout cannot choose where to come in from — which is the
 * decision scouting exists to inform. The floor is lowered to fit one on a
 * phone. The 26-cell apron already covers what the wider view exposes.
 */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.9;

/** Client render cap. Uncapped DPR on high-density Android is the biggest frame-rate risk. */
export const MAX_DPR = 2;

/*
 * Where a raider may put troops down.
 *
 * ALFA: "mengapa tidak bisa kerahkan pasukan?? kalo kaya gni lebih baik
 * persegiin garis merah loh"
 *
 * Because these two numbers were invisible. A tap that lands inside a
 * structure's footprint plus DEPLOY_CLEARANCE is refused, and the only thing
 * the player got back was a line of text — which answers "no" without ever
 * answering "where". The client draws the zone now, and it draws it from these,
 * which is why they live here rather than inside the simulation: a boundary
 * painted from a second copy of a number is a boundary that will one day be a
 * lie.
 */

/** Deploys must land this far outside a structure's footprint. */
export const DEPLOY_CLEARANCE = 1.6;
/** Deploys must stay this far inside the world edge. */
export const DEPLOY_MARGIN = 1.5;
