import { TYPES, ZOOM_MAX, ZOOM_MIN, clamp } from '@ironvow/config';
import { boatHit } from '../render/boat';
import { clampCam, s2g } from '../render/camera';
import {
  buildingAtScreen,
  deployAt,
  useItemAt,
  movePlacementTo,
  placeGhostAt,
  startPlacement,
  type World,
} from './world';

/**
 * Pointer handling: pan, pinch, tap, and drag to relocate — straight away on
 * the selected building, after a press and hold on any other.
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
  /** The selected building the press landed on, lifted on the first movement. */
  grab: string | null;
  /** Where in the footprint the finger is, so a drag keeps that point under it. */
  gdx: number;
  gdy: number;
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
    at: 0, pinch: 0, pinchZoom: 1, dragging: false, grab: null, gdx: 0, gdy: 0,
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
    ptr.grab = null;
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
        ptr.gdx = gx - p.gx;
        ptr.gdy = gy - p.gy;
      }
      return;
    }

    if (w.mode !== 'base') return;

    // A building that is already selected moves the moment it is dragged:
    // tap it, then pull it where it should go. One that is not needs a press
    // and hold first, so a pan that happens to start on a building does not
    // carry it off.
    const [gx, gy] = s2g(w.cam, w.vp, x, y);
    const b = buildingAtScreen(w, x, y);
    if (!b) return;
    if (w.selectedId === b.id) {
      // Armed, not picked up: it is lifted on the first real movement, so a
      // plain tap on it stays a tap.
      ptr.grab = b.id;
      return;
    }
    longPress = setTimeout(() => {
      if (!ptr.down || ptr.moved) return;
      startPlacement(w, b.type, b.id);
      ptr.dragging = true;
      const s = TYPES[b.type].s;
      ptr.gdx = Math.min(s - 0.01, Math.max(0, gx - b.gx));
      ptr.gdy = Math.min(s - 0.01, Math.max(0, gy - b.gy));
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
      w.events.onCameraMoved();
      return;
    }

    const [x, y] = xy(e);
    if (Math.abs(x - ptr.sx) > TAP_SLOP || Math.abs(y - ptr.sy) > TAP_SLOP) {
      ptr.moved = true;
      clearLongPress();
      if (ptr.grab && w.mode === 'base') {
        const [sgx, sgy] = s2g(w.cam, w.vp, ptr.sx, ptr.sy);
        const b = buildingAtScreen(w, ptr.sx, ptr.sy);
        if (b && b.id === ptr.grab) {
          startPlacement(w, b.type, b.id);
          ptr.dragging = true;
          // Grabbed by the roof: hold it by the nearest point of its footprint,
          // so it does not leap up the screen to put that point under the finger.
          const s = TYPES[b.type].s;
          ptr.gdx = Math.min(s - 0.01, Math.max(0, sgx - b.gx));
          ptr.gdy = Math.min(s - 0.01, Math.max(0, sgy - b.gy));
        }
        ptr.grab = null;
      }
    }

    if (ptr.dragging && w.mode === 'place') {
      const [gx, gy] = s2g(w.cam, w.vp, x, y);
      placeGhostAt(w, gx - ptr.gdx, gy - ptr.gdy);
    } else {
      w.cam.x -= (x - ptr.lx) / w.cam.z;
      w.cam.y -= (y - ptr.ly) / w.cam.z;
      clampCam(w.cam, w.vp.dpr);
      if (ptr.moved) w.events.onCameraMoved();
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
    ptr.grab = null;
    if (!wasTap) return;

    const [gx, gy] = s2g(w.cam, w.vp, ptr.sx, ptr.sy);

    if (w.mode === 'battle') {
      // An armed item takes the tap. It disarms itself on use, so the tap after
      // is a deploy again and there is no mode to get stuck in.
      if (w.selectedItem) useItemAt(w, gx, gy);
      else deployAt(w, gx, gy);
      return;
    }
    if (w.mode === 'place') {
      /*
       * One tap puts it there and starts it going up.
       *
       * `wasDragging` here only means the press landed on the ghost rather
       * than beside it — tapping the ghost is "yes, here", tapping the ground
       * is "there", and both are the same decision. A tap on a cell that is
       * already taken moves the ghost and stops, so the red footprint does the
       * explaining: a tap must never put a building anywhere but where it
       * landed. Sliding it to the nearest gap instead was tried, and a stray
       * tap beside a Rampart quietly laying another one somewhere else is
       * exactly how a base stops looking like anybody planned it.
       */
      if (!wasDragging) movePlacementTo(w, gx, gy);
      if (w.placement?.ok) w.events.onPlacementCommit();
      return;
    }
    if (wasDragging) return;

    void gx; void gy;

    /*
     * The boat first.
     *
     * It floats out past the plateau where no building can be, so the order
     * only matters at the far zoom levels where a hull can overlap the apron's
     * trees — but a tap that lands on both should take the one that goes
     * somewhere.
     */
    if (w.boat && !w.preview && w.mode === 'base'
      && boatHit({ ctx: null as never, cam: w.cam, vp: w.vp, t: w.t, night: 0 }, w.boat, ptr.sx, ptr.sy)) {
      w.events.onBoard();
      return;
    }

    const b = buildingAtScreen(w, ptr.sx, ptr.sy);
    onTapBuilding(b?.id ?? null);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    w.cam.z = clamp(w.cam.z * (e.deltaY > 0 ? 0.92 : 1.08), ZOOM_MIN, ZOOM_MAX);
    w.cam.tz = w.cam.z;
    clampCam(w.cam, w.vp.dpr);
    w.events.onCameraMoved();
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
