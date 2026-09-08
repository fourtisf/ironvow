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

/**
 * The same hold twice: soft underneath, sharp on top, and the sharp one masked
 * away toward the horizon.
 *
 * A game renders every tile at the same focus because a player has to be able
 * to read all of it. A photograph of one does not: a lens has a plane it is
 * focused on and everything behind it goes soft, and the eye reads that as
 * depth before it reads anything else. It is the cheapest thing on this page
 * that a flat render cannot fake.
 */
function HoldDof({ shot }: { shot: Shot }) {
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(7px) saturate(.9) brightness(.94)' }}>
        <Hold shot={shot} />
      </div>
      <div style={{
        position: 'absolute', inset: 0,
        WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0) 4%, rgba(0,0,0,.45) 26%, #000 52%)',
        maskImage: 'linear-gradient(180deg, rgba(0,0,0,0) 4%, rgba(0,0,0,.45) 26%, #000 52%)',
      }}
      >
        <Hold shot={shot} />
      </div>
    </>
  );
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


/**
 * One troop, drawn as large as you like on its own transparent canvas.
 *
 * Same trick as the near plane: `drawUnit` places a unit relative to the
 * camera, so the camera goes on the unit and the viewport is lied about to put
 * it where the composition wants it.
 */
function Figure({ type, level, scale, w: fw, h: fh }: {
  type: DeployableType; level: number; scale: number; w: number; h: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const made = world(fw, fh, canvas);
    if (!made) return;
    const [wd, ctx] = made;
    wd.cam.z = scale;
    wd.cam.tz = scale;
    wd.cam.x = 0;
    wd.cam.y = 0;
    // Feet a little below the middle, so the figure sits on the line rather
    // than floating in the middle of its own box.
    wd.vp = { w: fw, h: fh * 1.42, dpr: 2 };
    drawUnit({ ctx, cam: wd.cam, vp: wd.vp, t: wd.t }, {
      type, level, x: 0, y: 0, mine: true, hp: 1, maxHp: 1,
      moving: false, face: 1, swing: 0.35, flash: 0, born: 0,
    });
  }, [type, level, scale, fw, fh]);
  return <canvas ref={ref} style={{ width: fw, height: fh, display: 'block' }} />;
}

/** Dusk, laid over the day the renderer draws. */
const NIGHT: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  mixBlendMode: 'multiply',
  background:
    'linear-gradient(168deg, #4b5c9e 0%, #26305e 44%, #0d1230 100%)',
};

/** And the light the hold makes for itself once the sun is off it. */
const HEARTH: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background:
    'radial-gradient(ellipse 26% 30% at 36% 52%, rgba(255,178,86,.26), rgba(255,178,86,0) 72%),'
    + 'radial-gradient(ellipse 15% 18% at 24% 40%, rgba(255,158,64,.24), rgba(255,158,64,0) 72%),'
    + 'radial-gradient(ellipse 14% 17% at 50% 64%, rgba(255,158,64,.22), rgba(255,158,64,0) 72%),'
    + 'radial-gradient(ellipse 82% 84% at 38% 50%, rgba(0,0,0,0) 30%, rgba(4,8,22,.72) 100%)',
};


/**
 * The grade.
 *
 * Everything between the render and the picture. Three passes, in the order a
 * colourist would run them:
 *
 *  - **Split tone.** Warm into the highlights from the top left, cool teal into
 *    the shadows at the bottom right. Flat vector art has no colour temperature
 *    of its own, and giving it one is most of the difference between a render
 *    and a photograph.
 *  - **Vignette.** Off-centre, so it reads as a lens rather than a filter.
 *  - **Grain.** Fractal noise at seven per cent over the whole frame. It is the
 *    single strongest "this was photographed" cue there is, and on flat colour
 *    it also breaks up the banding a big gradient leaves on a phone screen.
 */
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function Grade({ hairline = true }: { hairline?: boolean }) {
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'soft-light',
        background:
          'radial-gradient(ellipse 70% 78% at 20% 4%, rgba(255,206,132,.85), rgba(255,206,132,0) 60%),'
          + 'linear-gradient(126deg, rgba(0,0,0,0) 40%, rgba(28,86,110,.75) 100%)',
      }}
      />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background:
          'radial-gradient(ellipse 62% 70% at 22% 8%, rgba(255,214,140,.16), rgba(255,214,140,0) 62%),'
          + 'radial-gradient(ellipse 86% 86% at 40% 46%, rgba(0,0,0,0) 44%, rgba(4,12,18,.66) 100%)',
      }}
      />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: GRAIN, opacity: 0.07, mixBlendMode: 'overlay',
      }}
      />
      {hairline && <div style={HAIRLINE} />}
    </>
  );
}

/**
 * The scrim.
 *
 * Taking the panel off was right — a card on key art is a slide — but the type
 * then sat on bright grass and vanished. Key art does not solve that with a
 * box, it solves it with a graded falloff: the frame darkens toward the side
 * the words are on, over four hundred pixels, and the eye never registers the
 * edge because there isn't one.
 */
const SCRIM_RIGHT: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background: 'linear-gradient(270deg, rgba(5,11,20,.96) 0%, rgba(5,11,20,.88) 26%,'
    + ' rgba(5,11,20,.48) 46%, rgba(5,11,20,0) 66%)',
};

const SCRIM_LEFT: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background: 'linear-gradient(90deg, rgba(5,11,20,.92) 0%, rgba(5,11,20,.72) 24%,'
    + ' rgba(5,11,20,.34) 46%, rgba(5,11,20,0) 66%)',
};

const SCRIM_FOOT: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background: 'linear-gradient(0deg, rgba(5,11,20,.92) 0%, rgba(5,11,20,.62) 22%,'
    + ' rgba(5,11,20,0) 48%)',
};

/** The headline face: the game's own, not the browser's. */
const DISPLAY = "'Arial Black','Segoe UI Black',Impact,Arial,sans-serif";

/** Small caps over a hairline rule — the label the game uses on every panel. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Arial', fontWeight: 900, fontSize: 13, letterSpacing: 5.5, color: GOLD,
    }}
    >
      {children}
    </div>
  );
}

/**
 * The line, and there is one.
 *
 * The first pass put three bullet points on a key image. Key art carries a
 * mark, one line and where to go; everything else belongs in the post, where it
 * can be read at leisure and rewritten without re-rendering anything.
 */
function Line({ children, size = 34 }: { children: React.ReactNode; size?: number }) {
  return (
    <div style={{
      fontFamily: DISPLAY, fontSize: size, lineHeight: 1.22, color: '#f7ecd2',
      letterSpacing: -0.4, textShadow: '0 3px 0 rgba(0,0,0,.42), 0 14px 34px rgba(0,0,0,.5)',
    }}
    >
      {children}
    </div>
  );
}

/** The address, set as a rule rather than a button: a button on key art is a
 *  button nobody can press. */
function Address() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <span style={{ width: 46, height: 2, background: GOLD }} />
      <span style={{
        fontFamily: 'Arial', fontWeight: 900, fontSize: 21, letterSpacing: 3.4, color: '#f2e4c4',
      }}
      >
        IRONVOW.XYZ
      </span>
      <span style={{
        fontFamily: 'Arial', fontWeight: 900, fontSize: 12, letterSpacing: 2.6, color: '#8fa6c4',
      }}
      >
        NO INSTALL
      </span>
    </div>
  );
}

export default function BannerPage() {

  return (
    <div style={{ padding: 24, background: '#0d1420', minHeight: '100vh' }}>

      {/*
        * 1 — the launch post.
        *
        * A mark, one line, an address. The first pass had three bullet points
        * on it, which is a slide, not key art: everything that can be read at
        * leisure belongs in the post, where it can be rewritten without
        * re-rendering anything.
        */}
      <Frame id="banner" w={W} h={H} note="post 1 — the launch">
        {/* Pushed two cells across the screen's own axis so the base clears
            the mark: `gx - gy` is what moves a thing sideways, not `gx`. */}
        <HoldDof shot={{ w: W, h: H, gx: 35.6, gy: 19.4, zoom: 0.66 }} />
        <NearPlane rank={NEAR} />
        <div style={FLOOR} />
        <Grade />
        <div style={SCRIM_RIGHT} />
        <div style={{
          position: 'absolute', right: 88, top: '50%', transform: 'translateY(-50%)', width: 566,
        }}
        >
          <Wordmark width={506} />
          <div style={{ marginTop: 26 }}>
            <Eyebrow>BUILD · TRAIN · CONQUER</Eyebrow>
          </div>
          <div style={{ marginTop: 26 }}>
            <Line>
              A base that works
              <br />
              while you sleep.
            </Line>
          </div>
          <div style={{ marginTop: 32 }}>
            <Address />
          </div>
        </div>
      </Frame>

      {/*
        * 2 — the profile header.
        *
        * Not a post, and the highest-value picture here anyway: every click on
        * a post lands on the profile. X overlaps the avatar at the bottom left
        * and crops both edges on some clients, so the left quarter and the
        * edges belong to the hold and everything that must be read sits in the
        * middle band, right of centre.
        */}
      <Frame id="header" w={1500} h={500} note="X profile header — avatar sits bottom left">
        <HoldDof shot={{ w: 1500, h: 500, gx: 35.4, gy: 21.8, zoom: 0.62 }} />
        <Grade hairline={false} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(90deg, rgba(5,11,20,.34) 0%, rgba(5,11,20,0) 30%,'
            + ' rgba(5,11,20,.52) 58%, rgba(5,11,20,.92) 100%)',
        }}
        />
        <div style={{
          position: 'absolute', right: 100, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 20,
        }}
        >
          <Wordmark width={412} />
          <Eyebrow>BUILD · TRAIN · CONQUER</Eyebrow>
          <Address />
        </div>
      </Frame>

      {/*
        * 3 — the raid.
        *
        * The launch image is a hold standing still, and nobody plays a base
        * builder because a base is nice. Enemy livery: the red roofs are the
        * game's own signal for "not yours", and the warband walks in above the
        * line rather than behind it.
        */}
      <Frame id="raid" w={W} h={H} note="post 3 — the verb">
        <HoldDof shot={{ w: W, h: H, gx: 30.6, gy: 24.4, zoom: 0.78, enemy: true }} />
        <NearPlane rank={ASSAULT} />
        <div style={FLOOR} />
        <Grade />
        <div style={SCRIM_FOOT} />
        <div style={SCRIM_LEFT} />
        <div style={{ position: 'absolute', left: 84, top: 70 }}>
          <Wordmark width={300} />
        </div>
        <div style={{ position: 'absolute', left: 84, bottom: 78, width: 900 }}>
          <Eyebrow>RAID REAL PLAYERS</Eyebrow>
          <div style={{ marginTop: 22 }}>
            <Line>
              Scout it. Drop them.
              <br />
              Three stars or nothing.
            </Line>
          </div>
          <div style={{ marginTop: 30 }}>
            <Address />
          </div>
        </div>
      </Frame>

      {/*
        * 4 — day one against the ceiling.
        *
        * Both halves at the same zoom, which is the whole argument: the five
        * buildings a hold starts with sit comfortably in their half and the
        * finished one runs off three edges of its own.
        */}
      <Frame id="growth" w={W} h={H} note="post — day one vs the ceiling">
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <HoldDof shot={{ w: W / 2, h: H, gx: 28.5, gy: 30.6, zoom: 0.62, opening: true }} />
          </div>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <HoldDof shot={{ w: W / 2, h: H, gx: 28.5, gy: 28.5, zoom: 0.62 }} />
          </div>
        </div>
        <Grade />
        <div style={{
          position: 'absolute', left: W / 2 - 1, top: 0, bottom: 0, width: 2,
          background: `linear-gradient(180deg, rgba(232,178,60,0), ${GOLD} 18%, ${GOLD} 82%, rgba(232,178,60,0))`,
          boxShadow: '0 0 30px rgba(232,178,60,.55)',
        }}
        />
        {[['DAY ONE', 'Five buildings and a Town Hall'], ['TOWN HALL 9', 'Everything, at its ceiling']].map(
          ([cap, sub], i) => (
            <div key={cap} style={{ position: 'absolute', top: 66, left: i === 0 ? 84 : W / 2 + 84 }}>
              <Eyebrow>{cap}</Eyebrow>
              <div style={{
                fontFamily: 'Arial', fontWeight: 700, fontSize: 21, color: '#e6d9bd', marginTop: 12,
              }}
              >
                {sub}
              </div>
            </div>
          ),
        )}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(0deg, rgba(6,14,22,.86), rgba(6,14,22,0) 320px)',
        }}
        />
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 70,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26,
        }}
        >
          <Wordmark width={330} />
          <Address />
        </div>
      </Frame>

      {/*
        * 5 — thread post 2: it works while you are gone.
        *
        * The one thing about the game that is true when nobody is looking, so
        * the picture is the hold at dusk with its own fires on. The renderer
        * only draws daylight; the night is a multiply over the whole frame and
        * the warmth is put back where the braziers and the forges are.
        */}
      <Frame id="night" w={W} h={H} note="post 2 — offline production">
        <HoldDof shot={{ w: W, h: H, gx: 31.6, gy: 24.4, zoom: 0.7 }} />
        <div style={NIGHT} />
        <div style={HEARTH} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: GRAIN, opacity: 0.07, mixBlendMode: 'overlay',
        }}
        />
        <div style={SCRIM_RIGHT} />
        <div style={HAIRLINE} />
        <div style={{ position: 'absolute', left: 84, top: 70 }}>
          <Wordmark width={300} />
        </div>
        <div style={{ position: 'absolute', right: 88, bottom: 84, width: 660, textAlign: 'right' }}>
          <Eyebrow>WHILE YOU ARE AWAY</Eyebrow>
          <div style={{ marginTop: 22 }}>
            <Line>
              Mines fill. Forges smelt.
              <br />
              Troops finish training.
            </Line>
          </div>
          <div style={{ marginTop: 30, display: 'flex', justifyContent: 'flex-end' }}>
            <Address />
          </div>
        </div>
      </Frame>

      {/*
        * 6 — thread post 4: what a level actually buys.
        *
        * The same Raider at one, five and nine, drawn by the same `drawUnit`
        * the raid uses. Leather, then banded steel, then plate and a plume. A
        * number in a menu cannot say this.
        */}
      <Frame id="levels" w={W} h={H} note="post 4 — every level is a different soldier">
        <HoldDof shot={{ w: W, h: H, gx: 28.5, gy: 28.5, zoom: 0.8 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,14,24,.82)' }} />
        <Grade />
        <div style={{
          position: 'absolute', inset: 0, padding: '62px 84px 58px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
        >
          <Wordmark width={286} />
          <div style={{ marginTop: 24 }}>
            <Eyebrow>NINE LEVELS · EVERY ONE A DIFFERENT SOLDIER</Eyebrow>
          </div>
          <div style={{
            marginTop: 26, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 26,
          }}
          >
            {[1, 5, 9].map((lv, i) => (
              <div key={lv} style={{ display: 'flex', alignItems: 'flex-end', gap: 26 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Wide enough for the blade: the first pass cut it off at
                    * the edge of its own canvas. */}
                  <Figure type="raider" level={lv} scale={2.2} w={300} h={286} />
                  <div style={{
                    width: 128, height: 2, marginTop: 6,
                    background: lv === 9
                      ? `linear-gradient(90deg, rgba(232,178,60,0), ${GOLD}, rgba(232,178,60,0))`
                      : 'linear-gradient(90deg, rgba(143,166,196,0), rgba(143,166,196,.6), rgba(143,166,196,0))',
                  }}
                  />
                  <div style={{
                    fontFamily: 'Arial', fontWeight: 900, fontSize: 15, letterSpacing: 4,
                    color: lv === 9 ? GOLD : '#8fa6c4', marginTop: 14,
                  }}
                  >
                    LEVEL {lv}
                  </div>
                </div>
                {i < 2 && (
                  <div style={{
                    fontFamily: DISPLAY, fontSize: 38, color: 'rgba(232,178,60,.65)', paddingBottom: 120,
                  }}
                  >
                    ›
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <Address />
        </div>
      </Frame>

      {/*
        * 7 — thread post 5: the war.
        *
        * Two holds, and the only difference between them is whose they are:
        * same renderer, same buildings, the player's blue on the left and the
        * enemy's red on the right.
        */}
      <Frame id="war" w={W} h={H} note="post 5 — clan war">
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <HoldDof shot={{ w: W / 2, h: H, gx: 28.5, gy: 28.5, zoom: 0.55 }} />
          </div>
          <div style={{ position: 'relative', width: W / 2, height: H, overflow: 'hidden' }}>
            <HoldDof shot={{ w: W / 2, h: H, gx: 28.5, gy: 28.5, zoom: 0.55, enemy: true }} />
          </div>
        </div>
        <Grade />
        <div style={{
          position: 'absolute', left: W / 2 - 1, top: 0, bottom: 0, width: 2,
          background: `linear-gradient(180deg, rgba(232,178,60,.2), ${GOLD} 16%, ${GOLD} 84%, rgba(232,178,60,.2))`,
          boxShadow: '0 0 34px rgba(232,178,60,.65)',
        }}
        />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(0deg, rgba(6,14,22,.88), rgba(6,14,22,0) 330px),'
            + 'linear-gradient(180deg, rgba(6,14,22,.86), rgba(6,14,22,.22) 200px, rgba(6,14,22,0) 310px)',
        }}
        />
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 72,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        }}
        >
          <Eyebrow>CLAN WAR</Eyebrow>
          <Line size={31}>Ten a side. Two attacks each. Twenty-four hours.</Line>
        </div>
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 70,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
        }}
        >
          <Wordmark width={252} />
          <Address />
        </div>
      </Frame>
    </div>
  );
}
