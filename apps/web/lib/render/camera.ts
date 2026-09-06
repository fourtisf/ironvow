import { IN0, IN1, N, TH, TW, ZOOM_MAX, ZOOM_MIN, clamp } from '@ironvow/config';

/**
 * Isometric projection and the camera.
 *
 * The prototype kept all of this in module globals. Here it is an explicit
 * object threaded through the draw calls, because a React app can mount, unmount
 * and remount a canvas, and a stale global is exactly how that goes wrong.
 */

export interface Camera {
  /** World-space centre. */
  x: number;
  y: number;
  /** Current zoom. */
  z: number;
  /** Zoom being eased toward. */
  tz: number;
}

export interface Viewport {
  w: number;
  h: number;
  dpr: number;
}

export function newCamera(): Camera {
  return { x: 0, y: 0, z: 1, tz: 1 };
}

export const isoX = (gx: number, gy: number): number => ((gx - gy) * TW) / 2;
export const isoY = (gx: number, gy: number): number => ((gx + gy) * TH) / 2;

/** World to screen. */
export function w2s(cam: Camera, vp: Viewport, wx: number, wy: number): [number, number] {
  return [(wx - cam.x) * cam.z + vp.w / 2, (wy - cam.y) * cam.z + vp.h / 2];
}

/** Screen to world. */
export function s2w(cam: Camera, vp: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - vp.w / 2) / cam.z + cam.x, (sy - vp.h / 2) / cam.z + cam.y];
}

/** Screen to grid. Fractional — callers round only when they mean to. */
export function s2g(cam: Camera, vp: Viewport, sx: number, sy: number): [number, number] {
  const [wx, wy] = s2w(cam, vp, sx, sy);
  return [(wx / (TW / 2) + wy / (TH / 2)) / 2, (wy / (TH / 2) - wx / (TW / 2)) / 2];
}

/**
 * Keep the camera over the field.
 *
 * Prototype bug #5: clamping the screen rectangle against a bounding box let
 * you pan past the corner, because the widest point of an isometric diamond is
 * nowhere near its corner. What is actually clamped is the grid coordinate
 * under the centre of the screen, so the treeline apron is always the furthest
 * anything can reach.
 */
export function clampCam(cam: Camera, dpr = 1): void {
  cam.z = snapZoom(cam.z, dpr);
  const gx = (cam.x / (TW / 2) + cam.y / (TH / 2)) / 2;
  const gy = (cam.y / (TH / 2) - cam.x / (TW / 2)) / 2;
  const lo = IN0 + 1;
  const hi = IN1 - 1;
  const cgx = clamp(gx, lo, hi);
  const cgy = clamp(gy, lo, hi);
  cam.x = isoX(cgx, cgy);
  cam.y = isoY(cgx, cgy);
}

export function centerOn(cam: Camera, gx: number, gy: number, z?: number, dpr = 1): void {
  if (z !== undefined) {
    cam.z = z;
    cam.tz = z;
  }
  cam.x = isoX(gx, gy);
  cam.y = isoY(gx, gy);
  clampCam(cam, dpr);
}

/**
 * Zoom, snapped so that a tile is a whole number of device pixels wide.
 *
 * The grass is a repeating pattern, and a pattern whose tile is not a whole
 * number of pixels is either resampled every frame (five times the cost of a
 * plain fill, measured) or drifts off the grid by half a pixel a tile. Neither
 * is acceptable, so the zoom itself is quantised instead. The step is under
 * one percent on any phone, which no one can see; it is why the zoom is not
 * eased, and why every path that sets it comes through here.
 */
export function snapZoom(z: number, dpr: number): number {
  const grain = TW * Math.max(1, dpr);
  const lo = Math.ceil(ZOOM_MIN * grain) / grain;
  const hi = Math.floor(ZOOM_MAX * grain) / grain;
  return clamp(Math.round(z * grain) / grain, lo, hi);
}

/**
 * Exact screen-space visibility test.
 *
 * Prototype bug #6: a grid-space bounding box is far larger than the real view
 * once projected, so it culled almost nothing and the frame budget went with
 * it. Projecting the point and testing it against the screen rectangle is both
 * cheaper and tight.
 */
export function onScreen(cam: Camera, vp: Viewport, gx: number, gy: number, pad = 70): boolean {
  const [sx, sy] = w2s(cam, vp, isoX(gx, gy), isoY(gx, gy));
  return sx > -pad && sx < vp.w + pad && sy > -pad && sy < vp.h + pad * 2.2;
}

/**
 * Visibility test for a structure rather than a point.
 *
 * A building is drawn upward from its anchor and outward across its footprint,
 * so testing the anchor alone would pop the tallest ones out of frame while
 * their roofs were still visible. The vertical allowance covers a maxed Keep
 * with its banner; erring high only costs a few extra draws at the screen edge.
 */
export function structOnScreen(
  cam: Camera, vp: Viewport, gx: number, gy: number, size: number,
): boolean {
  const [sx, sy] = w2s(cam, vp, isoX(gx, gy), isoY(gx, gy));
  const halfW = (size * TW) / 2 * cam.z;
  const above = 260 * cam.z;
  const below = size * TH * cam.z;
  return sx + halfW > 0 && sx - halfW < vp.w && sy + below > 0 && sy - above < vp.h;
}

/**
 * Frame a set of buildings so the whole base is on screen.
 *
 * The prototype could hard-code `centerOn(N/2, N/2, 0.95)` because it generated
 * its own opponents around the middle of the map. A real player's base sits
 * wherever they built it and can be much wider, and a raider who cannot see the
 * base cannot choose where to come in from — which is the decision the whole
 * mode is about. So the camera is fitted to what is actually there.
 */
export function frameBase(
  cam: Camera,
  vp: Viewport,
  buildings: readonly { gx: number; gy: number; size: number }[],
  margin = 70,
): void {
  if (buildings.length === 0) {
    centerOn(cam, N / 2, N / 2, 0.95, vp.dpr);
    return;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of buildings) {
    minX = Math.min(minX, b.gx);
    maxX = Math.max(maxX, b.gx + b.size);
    minY = Math.min(minY, b.gy);
    maxY = Math.max(maxY, b.gy + b.size);
  }

  // An isometric bounding box is a diamond: its screen width comes from the
  // gx - gy spread and its height from gx + gy, not from the grid extents.
  const spanW = ((maxX - minY) - (minX - maxY)) * (TW / 2);
  const spanH = ((maxX + maxY) - (minX + minY)) * (TH / 2);
  // Buildings are drawn upward from their footprint, so leave headroom for the
  // tallest one plus its level pip.
  const headroom = 190;

  const zx = (vp.w - margin * 2) / Math.max(1, spanW);
  const zy = (vp.h - margin * 2 - headroom) / Math.max(1, spanH);

  centerOn(cam, (minX + maxX) / 2, (minY + maxY) / 2, clamp(Math.min(zx, zy), ZOOM_MIN, ZOOM_MAX), vp.dpr);
}

/** Grid bounds of what the screen currently covers, for terrain iteration. */
export function visibleGrid(cam: Camera, vp: Viewport): [number, number, number, number] {
  const c0 = s2g(cam, vp, -120, -120);
  const c1 = s2g(cam, vp, vp.w + 120, -120);
  const c2 = s2g(cam, vp, vp.w + 120, vp.h + 120);
  const c3 = s2g(cam, vp, -120, vp.h + 120);
  return [
    Math.min(c0[0], c1[0], c2[0], c3[0]),
    Math.max(c0[0], c1[0], c2[0], c3[0]),
    Math.min(c0[1], c1[1], c2[1], c3[1]),
    Math.max(c0[1], c1[1], c2[1], c3[1]),
  ];
}
