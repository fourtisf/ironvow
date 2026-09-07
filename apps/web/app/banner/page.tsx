'use client';

import { useEffect, useRef } from 'react';
import type { DeployableType } from '@ironvow/types';
import { centerOn } from '../../lib/render/camera';
import { renderFrame } from '../../lib/game/render';
import { drawUnit } from '../../lib/render/units';
import { showcaseHold } from '../../lib/game/showcase';
import { createWorld, showPreview, type World, type WorldEvents } from '../../lib/game/world';

/*
 * The banner.
 *
 * ALFA: "buatkan beberapa banner untuk psotingan pertama x banner premium
 * harus sesuai sama gamenya" — then: "cukup 1 banner aja premium tapi".
 *
 * One image, and every pixel of art on it is the game drawing itself. The hold
 * is `showcaseHold` through the real renderer at the Keep's ceiling, the
 * warband in the foreground is the same `drawUnit` a raid uses, the wordmark is
 * the shipped SVG and the plate is the game's own palette. A banner that
 * promises something the game does not look like costs you the second click.
 *
 * Three things separate this from a screenshot with a caption on it, and they
 * are the whole of what "premium" means here:
 *
 *  - **Depth.** Two planes: the hold behind, at the camera the game uses, and
 *    a rank of troops in front at about twice that, walking out of the bottom
 *    of the frame. One flat plane reads as a screenshot; two read as a place.
 *    The first attempt put them at three times over and it was worse than
 *    flat — the art is drawn with a minimum stroke weight, so blown up past
 *    about half again it stops being a soldier and becomes a shape.
 *  - **Light.** A warm key from the top left and a cool fall-off into the
 *    bottom right, over an off-centre vignette. The renderer lights each
 *    building, but nothing was lighting the *picture*.
 *  - **No UI.** The level badges are off. They are how a player reads their own
 *    hold and they are the one thing in frame that says "menu" rather than
 *    "kingdom".
 *
 * Not linked from anywhere: `/banner` exists to be photographed.
 */

const W = 1600;
const H = 900;

const NOWHERE: WorldEvents = {
  onSelect: () => undefined,
  onModeChange: () => undefined,
  onToast: () => undefined,
  onPlayerChanged: () => undefined,
  onBattleEnd: () => undefined,
  onPlacementChanged: () => undefined,
  onPlacementCommit: () => undefined,
  onCameraMoved: () => undefined,
};

function world(w: number, h: number, canvas: HTMLCanvasElement): [World, CanvasRenderingContext2D] | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = 2;
  const world_: World = createWorld(NOWHERE);
  world_.vp = { w, h, dpr };
  world_.levelPips = false;
  // A fixed clock, so the fires and the smoke land the same way every run.
  world_.t = 7.3;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [world_, ctx];
}

/** The hold, at the camera the game itself would use. */
function useHold() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = world(W, H, canvas);
    if (!made) return;
    const [w, ctx] = made;
    showPreview(w, showcaseHold(), false);
    /*
     * Placed by hand, not fitted. The Keep sits about a third across so the
     * hold leads the eye into the plate, and it is close enough in that the
     * edge of the plateau — and the flat backdrop past it — stay out of frame.
     * `ZOOM_MIN` is how far back a *player* may pull so a raid cannot be fought
     * from orbit; it has nothing to say about a photograph.
     */
    centerOn(w.cam, 33.4, 21.6, 0.66, 2, 0.12);
    renderFrame(w, ctx);
  }, []);
  return ref;
}

interface Near {
  type: DeployableType;
  /** Screen position, in banner pixels, of the figure's feet. */
  x: number;
  y: number;
  scale: number;
  face: 1 | -1;
  swing: number;
}

/**
 * The near plane.
 *
 * Drawn on its own transparent canvas with its own camera, because the point
 * is that these are *not* at the hold's scale: at the hold's zoom a Raider is
 * a thumbnail among the rooftops, and at twice it, walking out of the bottom
 * of the frame, it is the thing the eye lands on first.
 */
const NEAR: Near[] = [
  { type: 'ram', x: 246, y: 968, scale: 1.70, face: 1, swing: 0.85 },
  { type: 'raider', x: 486, y: 928, scale: 1.48, face: 1, swing: 0.95 },
  { type: 'hero', x: 690, y: 984, scale: 1.76, face: 1, swing: 0.7 },
  { type: 'archer', x: 878, y: 918, scale: 1.32, face: 1, swing: 0.3 },
];

function useNear() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = world(W, H, canvas);
    if (!made) return;
    const [w, ctx] = made;
    // Sorted back to front, so a figure in front of another is drawn over it.
    for (const u of [...NEAR].sort((a, b) => a.y - b.y)) {
      w.cam.z = u.scale;
      w.cam.tz = u.scale;
      // `drawUnit` places the unit from the camera; putting the camera on the
      // unit puts the unit at the middle of the viewport, and the viewport is
      // then lied about to move it where the composition wants it.
      w.vp = { w: u.x * 2, h: u.y * 2, dpr: 2 };
      w.cam.x = 0;
      w.cam.y = 0;
      drawUnit({ ctx, cam: w.cam, vp: w.vp, t: w.t }, {
        type: u.type, x: 0, y: 0, mine: true, hp: 1, maxHp: 1,
        moving: false, face: u.face, swing: u.swing, flash: 0, born: 0, level: 9,
      });
    }
  }, []);
  return ref;
}

const GOLD = '#e8b23c';

const Wordmark = ({ width }: { width: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/wordmark.svg" alt="IRONVOW" width={646} height={162}
    style={{ width, height: 'auto', display: 'block', filter: 'drop-shadow(0 5px 0 rgba(0,0,0,.45))' }}
  />
);

function Bullet({ lead, rest }: { lead: string; rest: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
      <span style={{
        width: 9, height: 9, borderRadius: 9, background: GOLD, flex: 'none',
        transform: 'translateY(-2px)',
      }}
      />
      <div style={{ fontFamily: 'Arial', fontSize: 20, lineHeight: 1.45, color: '#c3d4ea' }}>
        <b style={{ color: '#f2e4c4' }}>{lead}</b> {rest}
      </div>
    </div>
  );
}

export default function BannerPage() {
  const hold = useHold();
  const near = useNear();

  return (
    <div style={{ padding: 24, background: '#0d1420', minHeight: '100vh' }}>
      <div style={{ fontFamily: 'Arial', fontSize: 12, color: '#8fa6c4', marginBottom: 8 }}>
        ironvow-banner · {W}×{H} · shot at 2× → {W * 2}×{H * 2}
      </div>

      <div id="banner" style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: '#1b2432' }}>
        <canvas ref={hold} style={{ position: 'absolute', inset: 0, display: 'block' }} />

        {/* Light: a warm key from the top left, cool fall-off into the bottom
            right, and an off-centre vignette. The renderer lights every
            building; nothing was lighting the picture. */}
        <div style={{
          position: 'absolute', inset: 0,
          background:
            'radial-gradient(ellipse 66% 74% at 22% 6%, rgba(255,214,140,.20), rgba(255,214,140,0) 62%),'
            + 'linear-gradient(128deg, rgba(10,22,16,0) 38%, rgba(7,16,26,.55) 100%),'
            + 'radial-gradient(ellipse 84% 84% at 38% 44%, rgba(0,0,0,0) 46%, rgba(5,14,10,.62) 100%)',
        }}
        />

        {/* The near plane, over the light, so the foreground is not washed. */}
        <canvas ref={near} style={{ position: 'absolute', inset: 0, display: 'block' }} />

        {/* A last darkening along the bottom, so the troops walk out of shade
            and the frame has a floor. */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(0deg, rgba(6,14,22,.70), rgba(6,14,22,.18) 210px, rgba(6,14,22,0) 330px)',
        }}
        />

        {/* The plate. */}
        <div style={{
          position: 'absolute', right: 72, top: '50%', transform: 'translateY(-50%)',
          width: 604, padding: '48px 50px 44px',
          background: 'linear-gradient(150deg, rgba(24,34,50,.95), rgba(11,18,29,.97))',
          border: `3px solid ${GOLD}`, borderRadius: 24,
          boxShadow: '0 22px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06)',
        }}
        >
          <Wordmark width={462} />

          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, marginTop: 22, marginBottom: 24,
          }}
          >
            <span style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, rgba(232,178,60,0), #e8b23c)' }} />
            <span style={{
              fontFamily: 'Arial', fontWeight: 900, fontSize: 15, letterSpacing: 4.5, color: GOLD,
              whiteSpace: 'nowrap',
            }}
            >
              FORGE · MUSTER · CONQUER
            </span>
            <span style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #e8b23c, rgba(232,178,60,0))' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Bullet lead="Build a hold" rest="that mines, forges and trains while you are away." />
            <Bullet lead="Raid real players" rest="— scout the base, drop your troops, take the stars." />
            <Bullet lead="Found a clan" rest="and go to war one day at a time." />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 30 }}>
            <div style={{
              padding: '17px 34px', borderRadius: 15,
              background: 'linear-gradient(#f0bf4c,#c4881f)', color: '#1a1206',
              fontFamily: 'Arial', fontWeight: 900, fontSize: 23, letterSpacing: 2.2,
              boxShadow: '0 5px 0 #8a5c1c, 0 12px 22px rgba(0,0,0,.45)',
            }}
            >
              IRONVOW.XYZ
            </div>
            <div style={{
              fontFamily: 'Arial', fontWeight: 900, fontSize: 13, letterSpacing: 2.4,
              color: '#8fa6c4', lineHeight: 1.6,
            }}
            >
              NO INSTALL
              <br />
              PLAYS IN YOUR BROWSER
            </div>
          </div>
        </div>

        {/* A hairline inside the edge. The cheapest thing in the file and the
            one that stops it reading as a cropped screenshot. */}
        <div style={{
          position: 'absolute', inset: 16, border: '1px solid rgba(232,178,60,.28)',
          borderRadius: 10, pointerEvents: 'none',
        }}
        />
      </div>
    </div>
  );
}
