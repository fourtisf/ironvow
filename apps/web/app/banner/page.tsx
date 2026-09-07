'use client';

import { useEffect, useRef } from 'react';
import type { DeployableType } from '@ironvow/types';
import { centerOn } from '../../lib/render/camera';
import { renderFrame } from '../../lib/game/render';
import { drawUnit } from '../../lib/render/units';
import { openingHold, showcaseHold } from '../../lib/game/showcase';
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

interface Shot {
  w: number;
  h: number;
  /** Where the camera looks, in grid cells, and how close. Set by hand per
   *  banner: a banner is a composition, and what matters is which corner of the
   *  hold sits under the text — not that all of it is on screen. */
  gx: number;
  gy: number;
  zoom: number;
  /** The maxed hold by default; the opening five buildings for the comparison. */
  opening?: boolean;
  /** Enemy livery. True for the raid banner: that is somebody else's hold. */
  enemy?: boolean;
}

/**
 * One still of a hold.
 *
 * `ZOOM_MIN` is how far back a *player* may pull, so a raid cannot be fought
 * from orbit; it has nothing to say about a photograph, hence the floor here.
 */
function useHold(shot: Shot) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = world(shot.w, shot.h, canvas);
    if (!made) return;
    const [w, ctx] = made;
    showPreview(w, shot.opening ? openingHold() : showcaseHold(), shot.enemy ?? false);
    centerOn(w.cam, shot.gx, shot.gy, shot.zoom, 2, 0.12);
    renderFrame(w, ctx);
  }, [shot]);
  return ref;
}

function Hold({ shot }: { shot: Shot }) {
  const ref = useHold(shot);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
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

/** The raid banner's rank: wider, and walking in from the left. */
const ASSAULT: Near[] = [
  // Above the plate, not behind it: the first pass put the whole warband
  // under the caption, which is a raid banner with no raid in it.
  { type: 'ram', x: 262, y: 744, scale: 1.44, face: 1, swing: 0.9 },
  { type: 'raider', x: 470, y: 700, scale: 1.24, face: 1, swing: 0.2 },
  { type: 'lancer', x: 648, y: 752, scale: 1.40, face: 1, swing: 0.8 },
  { type: 'archer', x: 826, y: 696, scale: 1.12, face: 1, swing: 0.35 },
  { type: 'hero', x: 1024, y: 758, scale: 1.48, face: 1, swing: 1 },
  { type: 'scaler', x: 1212, y: 702, scale: 1.10, face: 1, swing: 0.6 },
];

function useNear(rank: Near[], cw = W, ch = H) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = world(cw, ch, canvas);
    if (!made) return;
    const [w, ctx] = made;
    // Sorted back to front, so a figure in front of another is drawn over it.
    for (const u of [...rank].sort((a, b) => a.y - b.y)) {
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
  }, [rank, cw, ch]);
  return ref;
}

function NearPlane({ rank, cw, ch }: { rank: Near[]; cw?: number; ch?: number }) {
  const ref = useNear(rank, cw, ch);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
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

/** The light on the picture, not on the buildings. */
const LIGHT: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background:
    'radial-gradient(ellipse 66% 74% at 22% 6%, rgba(255,214,140,.20), rgba(255,214,140,0) 62%),'
    + 'linear-gradient(128deg, rgba(10,22,16,0) 38%, rgba(7,16,26,.55) 100%),'
    + 'radial-gradient(ellipse 84% 84% at 38% 44%, rgba(0,0,0,0) 46%, rgba(5,14,10,.62) 100%)',
};

/** Shade along the bottom, so the near plane walks out of it. */
const FLOOR: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background: 'linear-gradient(0deg, rgba(6,14,22,.70), rgba(6,14,22,.18) 210px, rgba(6,14,22,0) 330px)',
};

/** A hairline inside the edge: the cheapest thing in the file, and the one
 *  that stops a banner reading as a cropped screenshot. */
const HAIRLINE: React.CSSProperties = {
  position: 'absolute', inset: 16, border: '1px solid rgba(232,178,60,.28)',
  borderRadius: 10, pointerEvents: 'none',
};

const PILL: React.CSSProperties = {
  padding: '17px 34px', borderRadius: 15,
  background: 'linear-gradient(#f0bf4c,#c4881f)', color: '#1a1206',
  fontFamily: 'Arial', fontWeight: 900, fontSize: 23, letterSpacing: 2.2,
  boxShadow: '0 5px 0 #8a5c1c, 0 12px 22px rgba(0,0,0,.45)',
};

const PLATE: React.CSSProperties = {
  background: 'linear-gradient(150deg, rgba(24,34,50,.95), rgba(11,18,29,.97))',
  border: `3px solid ${GOLD}`, borderRadius: 24,
  boxShadow: '0 22px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06)',
};

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, rgba(232,178,60,0), #e8b23c)' }} />
      <span style={{
        fontFamily: 'Arial', fontWeight: 900, fontSize: 15, letterSpacing: 4.5, color: GOLD,
        whiteSpace: 'nowrap',
      }}
      >
        {children}
      </span>
      <span style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #e8b23c, rgba(232,178,60,0))' }} />
    </div>
  );
}

function Frame({ id, w, h, note, children }: {
  id: string; w: number; h: number; note: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: 'Arial', fontSize: 12, color: '#8fa6c4', marginBottom: 8 }}>
        {id} · {w}×{h} · shot at 2× → {w * 2}×{h * 2} · {note}
      </div>
      <div id={id} style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: '#1b2432' }}>
        {children}
      </div>
    </div>
  );
}

export default function BannerPage() {

  return (
    <div style={{ padding: 24, background: '#0d1420', minHeight: '100vh' }}>

      {/* 1 — the launch post. A finished hold, a warband in front of it, and
          what the game is in three lines. */}
      <Frame id="banner" w={W} h={H} note="the launch post">
        <Hold shot={{ w: W, h: H, gx: 33.4, gy: 21.6, zoom: 0.66 }} />
        <div style={LIGHT} />
        <NearPlane rank={NEAR} />
        <div style={FLOOR} />

        <div style={{
          ...PLATE,
          position: 'absolute', right: 72, top: '50%', transform: 'translateY(-50%)',
          width: 604, padding: '48px 50px 44px',
        }}
        >
          <Wordmark width={462} />
          <div style={{ marginTop: 22, marginBottom: 24 }}>
            <Rule>FORGE · MUSTER · CONQUER</Rule>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Bullet lead="Build a hold" rest="that mines, forges and trains while you are away." />
            <Bullet lead="Raid real players" rest="— scout the base, drop your troops, take the stars." />
            <Bullet lead="Found a clan" rest="and go to war one day at a time." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 30 }}>
            <div style={PILL}>IRONVOW.XYZ</div>
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
        <div style={HAIRLINE} />
      </Frame>

      {/*
        * 2 — the profile header.
        *
        * Not a post, and the highest-value picture here anyway: every click on
        * a post lands on the profile, and a default header loses people before
        * they reach the link. X overlaps the avatar at the bottom left and
        * crops the top and bottom on some clients, so the left quarter and both
        * edges are left to the hold and everything that has to be read sits in
        * the middle band, right of centre.
        */}
      <Frame id="header" w={1500} h={500} note="X profile header — avatar sits bottom left">
        <Hold shot={{ w: 1500, h: 500, gx: 35.4, gy: 21.8, zoom: 0.62 }} />
        <div style={LIGHT} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(90deg, rgba(6,14,22,.34) 0%, rgba(6,14,22,0) 34%,'
            + ' rgba(6,14,22,.30) 62%, rgba(6,14,22,.62) 100%)',
        }}
        />
        <div style={{
          position: 'absolute', right: 96, top: '50%', transform: 'translateY(-50%)',
          textAlign: 'right', width: 470,
        }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Wordmark width={404} />
          </div>
          <div style={{ marginTop: 20 }}>
            <Rule>FORGE · MUSTER · CONQUER</Rule>
          </div>
          <div style={{
            fontFamily: 'Arial', fontWeight: 900, fontSize: 17, letterSpacing: 2.6,
            color: '#c3d4ea', marginTop: 18,
          }}
          >
            IRONVOW.XYZ · NO INSTALL
          </div>
        </div>
      </Frame>

      {/*
        * 3 — the raid.
        *
        * The launch banner shows a hold standing still, and nobody plays a base
        * builder because a base is nice. They play it to take somebody else's.
        * So this one is in enemy livery — the red roofs are the game's own
        * signal for "not yours" — with the warband walking in.
        */}
      <Frame id="raid" w={W} h={H} note="second post — the verb">
        <Hold shot={{ w: W, h: H, gx: 30.6, gy: 24.4, zoom: 0.78, enemy: true }} />
        <div style={LIGHT} />
        <NearPlane rank={ASSAULT} />
        <div style={FLOOR} />

        <div style={{ position: 'absolute', left: 72, top: 62 }}>
          <Wordmark width={296} />
        </div>
        <div style={{
          ...PLATE,
          position: 'absolute', left: 72, right: 72, bottom: 58, padding: '30px 40px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 34,
        }}
        >
          <div>
            <div style={{
              fontFamily: 'Arial', fontWeight: 900, fontSize: 15, letterSpacing: 4.5, color: GOLD,
            }}
            >
              RAID REAL PLAYERS
            </div>
            <div style={{
              fontFamily: 'Arial', fontWeight: 700, fontSize: 26, color: '#f2e4c4', marginTop: 12,
            }}
            >
              Scout the base. Drop your warband. Take three stars.
            </div>
          </div>
          <div style={{ ...PILL, whiteSpace: 'nowrap' }}>IRONVOW.XYZ</div>
        </div>
        <div style={HAIRLINE} />
      </Frame>

      {/*
        * 4 — day one against the ceiling.
        *
        * Both halves at the same zoom, which is the whole argument: the five
        * buildings a hold starts with sit comfortably in their half, and the
        * finished one runs off three edges of its own. Half the reason anybody
        * plays a base builder is the gap between those two pictures, and no
        * screenshot of a menu has ever said it.
        */}
      <Frame id="growth" w={W} h={H} note="third post — day one vs the ceiling">
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <Hold shot={{ w: W / 2, h: H, gx: 28.5, gy: 30.6, zoom: 0.62, opening: true }} />
            <div style={LIGHT} />
          </div>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <Hold shot={{ w: W / 2, h: H, gx: 28.5, gy: 28.5, zoom: 0.62 }} />
            <div style={LIGHT} />
          </div>
        </div>

        {/* The join, lit so it reads as a seam rather than a mistake. */}
        <div style={{
          position: 'absolute', left: W / 2 - 2, top: 0, bottom: 0, width: 4,
          background: `linear-gradient(180deg, rgba(232,178,60,0), ${GOLD} 22%, ${GOLD} 78%, rgba(232,178,60,0))`,
          boxShadow: '0 0 26px rgba(232,178,60,.45)',
        }}
        />

        {[['DAY ONE', 'Five buildings and a Keep'], ['KEEP 9', 'Everything, at its ceiling']].map(
          ([cap, sub], i) => (
            <div
              key={cap}
              style={{
                position: 'absolute', top: 58, left: i === 0 ? 72 : W / 2 + 72,
                textAlign: 'left',
              }}
            >
              <div style={{
                fontFamily: 'Arial', fontWeight: 900, fontSize: 15, letterSpacing: 5, color: GOLD,
              }}
              >
                {cap}
              </div>
              <div style={{
                fontFamily: 'Arial', fontWeight: 700, fontSize: 21, color: '#f2e4c4', marginTop: 10,
              }}
              >
                {sub}
              </div>
            </div>
          ),
        )}

        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(0deg, rgba(6,14,22,.80), rgba(6,14,22,0) 300px)',
        }}
        />
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 58,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22,
        }}
        >
          <Wordmark width={330} />
          <div style={PILL}>IRONVOW.XYZ</div>
        </div>
        <div style={HAIRLINE} />
      </Frame>
    </div>
  );
}
