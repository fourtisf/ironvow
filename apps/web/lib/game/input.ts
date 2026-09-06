import { ZOOM_MAX, ZOOM_MIN, clamp } from '@ironvow/config';
import { clampCam, s2g } from '../render/camera';
import {
  buildingAt,
  deployAt,
  movePlacementTo,
  startPlacement,
  type World,
} from './world';

/**
 * Pointer handling: pan, pinch, tap, and press-and-drag to relocate.
 *
 * Bound directly to the canvas rather than going through React events, because
 * these fire far more often than a frame and every one of them would otherwise
 * schedule a render the game does not need.
 */

interface Pointer {
  down: boolean;
  moved: boolean;
  /** Where the press started, for the tap-versus-drag test. */
  sx: number;
  sy: number;
  /** Last position, for incremental panning. */
  lx: number;
  ly: number;
  at: number;
  /** Distance between two fingers when the pinch began. */
  pinch: number;
  pinchZoom: number;
  /** True while the pointer is moving a building instead of the camera. */
  dragging: boolean;
}

const TAP_SLOP = 12;
const LONG_PRESS_MS = 300;

export interface InputHandle {
  detach: () => void;
}

export function attachInput(
  w: World,
  canvas: HTMLCanvasElement,
  onTapBuilding: (buildingId: string | null) => void,
): InputHandle {
  const ptr: Pointer = {
    down: false, moved: false, sx: 0, sy: 0, lx: 0, ly: 0,
    at: 0, pinch: 0, pinchZoom: 1, dragging: false,
  };
  let longPress: ReturnType<typeof setTimeout> | null = null;

  const clearLongPress = (): void => {
    if (longPress) clearTimeout(longPress);
    longPress = null;
  };

  const xy = (e: TouchEvent | MouseEvent): [number, number] => {
    if ('touches' in e && e.touches.length > 0) {
      const t = e.touches[0]!;
      return [t.clientX, t.clientY];
    }
    const m = e as MouseEvent;
    return [m.clientX, m.clientY];
  };

  const pinchDistance = (e: TouchEvent): number => {
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onDown = (e: TouchEvent | MouseEvent): void => {
    const [x, y] = xy(e);
    ptr.down = true;
    ptr.moved = false;
    ptr.dragging = false;
    ptr.sx = x; ptr.sy = y;
    ptr.lx = x; ptr.ly = y;
    ptr.at = Date.now();

    if ('touches' in e && e.touches.length === 2) {
      ptr.pinch = pinchDistance(e);
      ptr.pinchZoom = w.cam.z;
      return;
    }

    if (w.mode === 'place' && w.placement) {
      // Grabbing the ghost drags it instead of the camera.
      const [gx, gy] = s2g(w.cam, w.vp, x, y);
      const p = w.placement;
      const s = 3;
      if (gx >= p.gx - 1 && gx < p.gx + s + 1 && gy >= p.gy - 1 && gy < p.gy + s + 1) {
        ptr.dragging = true;
      }
      return;
    }

    if (w.mode !== 'base') return;

    // Press and hold on a building picks it up. The Keep never moves.
    const [gx, gy] = s2g(w.cam, w.vp, x, y);
    const b = buildingAt(w, gx, gy);
    if (!b || b.type === 'keep') return;
    longPress = setTimeout(() => {
      if (!ptr.down || ptr.moved) return;
      startPlacement(w, b.type, b.id);
      ptr.dragging = true;
      w.events.onToast(`Carrying the ${b.type} — drop it where you want`);
    }, LONG_PRESS_MS);
  };

  const onMove = (e: TouchEvent | MouseEvent): void => {
    if (!ptr.down) return;
    e.preventDefault();

    if ('touches' in e && e.touches.length === 2 && ptr.pinch > 0) {
      const scale = pinchDistance(e) / ptr.pinch;
      w.cam.z = clamp(ptr.pinchZoom * scale, ZOOM_MIN, ZOOM_MAX);
      w.cam.tz = w.cam.z;
      clampCam(w.cam, w.vp.dpr);
      ptr.moved = true;
      return;
    }

    const [x, y] = xy(e);
    if (Math.abs(x - ptr.sx) > TAP_SLOP || Math.abs(y - ptr.sy) > TAP_SLOP) {
      ptr.moved = true;
      clearLongPress();
    }

    if (ptr.dragging && w.mode === 'place') {
      const [gx, gy] = s2g(w.cam, w.vp, x, y);
      movePlacementTo(w, gx, gy);
    } else {
      w.cam.x -= (x - ptr.lx) / w.cam.z;
      w.cam.y -= (y - ptr.ly) / w.cam.z;
      clampCam(w.cam, w.vp.dpr);
    }
    ptr.lx = x;
    ptr.ly = y;
  };

  const onUp = (e: TouchEvent | MouseEvent): void => {
    clearLongPress();
    const wasTap = ptr.down && !ptr.moved && Date.now() - ptr.at < 400;
    ptr.down = false;
    ptr.pinch = 0;
    const wasDragging = ptr.dragging;
    ptr.dragging = false;
    if (!wasTap || wasDragging) return;

    const [gx, gy] = s2g(w.cam, w.vp, ptr.sx, ptr.sy);

    if (w.mode === 'battle') {
      deployAt(w, gx, gy);
      return;
    }
    if (w.mode === 'place') {
      movePlacementTo(w, gx, gy);
      return;
    }

    const b = buildingAt(w, gx, gy);
    onTapBuilding(b?.id ?? null);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    w.cam.z = clamp(w.cam.z * (e.deltaY > 0 ? 0.92 : 1.08), ZOOM_MIN, ZOOM_MAX);
    w.cam.tz = w.cam.z;
    clampCam(w.cam, w.vp.dpr);
  };

  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);
  canvas.addEventListener('touchcancel', onUp);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    detach() {
      clearLongPress();
      canvas.removeEventListener('touchstart', onDown);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onUp);
      canvas.removeEventListener('touchcancel', onUp);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
