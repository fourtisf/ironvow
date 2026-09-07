'use client';

import { useEffect, useRef } from 'react';
import type { DeployableType } from '@ironvow/types';
import { centerOn } from '../../lib/render/camera';
import { renderFrame } from '../../lib/game/render';
import { drawUnit } from '../../lib/render/units';
import { showcaseHold } from '../../lib/game/showcase';
import { createWorld, showPreview, type World, type WorldEvents } from '../../lib/game/world';
import { TroopArt } from '../../components/TroopArt';

/*
 * The banner workbench.
 *
 * ALFA: "buatkan beberapa banner untuk psotingan pertama x banner premium
 * harus sesuai sama gamenya"
 *
 * Every pixel of art on these is the game drawing itself. No mock-ups and no
 * stand-in graphics: the hold is `showcaseHold` through the real renderer, the
 * troops are the same `drawUnit` a raid uses, the wordmark is the shipped SVG
 * and the panels are the game's own palette. A banner that promises something
 * the game does not look like is a banner that costs you the second click.
 *
 * Not linked from anywhere. It exists to be photographed: `/banner` renders
 * each one at its exact size, and the capture script screenshots the elements.
 */

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

/** Troops standing in front of the hold, for the banners that want an army. */
interface Extra {
  type: DeployableType;
  gx: number;
  gy: number;
  face: 1 | -1;
  swing: number;
}

interface Shot {
  /** Where the camera looks, in grid cells. */
  gx: number;
  gy: number;
  zoom: number;
  units?: Extra[];
}

/**
 * One still of the hold.
 *
 * The camera is set by hand per banner rather than fitted, because a banner is
 * a composition: what matters is which corner of the hold is under the text,
 * not that all of it is on screen.
 */
function useHoldShot(shot: Shot, w: number, h: number) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = 2;
    const world: World = createWorld(NOWHERE);
    world.vp = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    showPreview(world, showcaseHold(), false);
    // Below the game's own floor: `ZOOM_MIN` stops a player fighting a raid
    // from orbit and has nothing to say about a photograph.
    centerOn(world.cam, shot.gx, shot.gy, shot.zoom, dpr, 0.12);
    // A fixed clock, so the fires and the smoke land the same way every run.
    world.t = 7.3;
    renderFrame(world, ctx);

    for (const u of shot.units ?? []) {
      drawUnit({ ctx, cam: world.cam, vp: world.vp, t: world.t }, {
        type: u.type, x: u.gx, y: u.gy, mine: true, hp: 1, maxHp: 1,
        moving: false, face: u.face, swing: u.swing, flash: 0, born: 0,
        level: 9,
      });
    }
  }, [shot, w, h]);
  return ref;
}

function Hold({ shot, w, h }: { shot: Shot; w: number; h: number }) {
  const ref = useHoldShot(shot, w, h);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

const Wordmark = ({ width }: { width: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/wordmark.svg" alt="IRONVOW" width={646} height={162}
    style={{ width, height: 'auto', display: 'block', filter: 'drop-shadow(0 4px 0 rgba(0,0,0,.4))' }}
  />
);

const TAG: React.CSSProperties = {
  fontFamily: 'Arial', fontWeight: 900, letterSpacing: 3,
  color: '#8fa6c4', textTransform: 'uppercase',
};

/** The dark plate the game puts under everything it wants read. */
const PLATE: React.CSSProperties = {
  background: 'linear-gradient(rgba(20,29,43,.93),rgba(13,20,32,.95))',
  border: '3px solid #e8b23c',
  borderRadius: 22,
  boxShadow: '0 14px 40px rgba(0,0,0,.55)',
};

const VIGNETTE: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  background:
    'radial-gradient(ellipse 78% 70% at 50% 46%, rgba(0,0,0,0) 52%, rgba(6,16,10,.55) 100%),'
    + 'linear-gradient(rgba(6,12,20,.30), rgba(6,12,20,0) 190px)',
};

function Frame({ id, w, h, children }: {
  id: string; w: number; h: number; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: 'Arial', fontSize: 12, color: '#8fa6c4', marginBottom: 6 }}>
        {id} · {w}×{h}
      </div>
      <div
        id={id}
        style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: '#1b2432' }}
      >
        {children}
      </div>
    </div>
  );
}

const TROOPS: DeployableType[] = ['raider', 'archer', 'lancer', 'scaler', 'ram', 'hero'];
const TROOP_NAME: Record<string, string> = {
  raider: 'RAIDER', archer: 'ARCHER', lancer: 'LANCER',
  scaler: 'SCALER', ram: 'RAM', hero: 'VOWKEEPER',
};

export default function BannerPage() {
  return (
    <div style={{ padding: 24, background: '#0d1420', minHeight: '100vh' }}>

      {/* 1 — the post image. A finished hold, and what the game is in six words. */}
      <Frame id="post-hero" w={1600} h={900}>
        {/* Placed by hand: the Keep about a third across, the hold running under
            the plate, and close enough in that the edge of the map never shows. */}
        <Hold shot={{ gx: 34, gy: 21, zoom: 0.62 }} w={1600} h={900} />
        <div style={VIGNETTE} />
        <div style={{
          position: 'absolute', right: 74, top: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26,
          width: 620,
        }}
        >
          <div style={{ ...PLATE, padding: '44px 46px 40px' }}>
            <Wordmark width={470} />
            <div style={{ ...TAG, fontSize: 19, marginTop: 20, color: '#e8b23c' }}>
              Forge · Muster · Conquer
            </div>
            <div style={{
              fontFamily: 'Arial', fontWeight: 700, fontSize: 22, lineHeight: 1.55,
              color: '#c3d4ea', marginTop: 22,
            }}
            >
              Build a hold that mines and trains while you sleep.
              Raid real players. Take the stars.
            </div>
            <div style={{
              marginTop: 28, display: 'inline-block', padding: '15px 30px', borderRadius: 14,
              background: 'linear-gradient(#e8b23c,#c4881f)', color: '#1a1206',
              fontFamily: 'Arial', fontWeight: 900, fontSize: 22, letterSpacing: 2,
            }}
            >
              IRONVOW.XYZ
            </div>
          </div>
        </div>
      </Frame>

      {/* 2 — the profile header. X puts the avatar bottom-left and crops the
          top and bottom on some clients, so everything lives in the middle
          band and the left quarter is left to the hold. */}
      <Frame id="header" w={1500} h={500}>
        <Hold shot={{ gx: 35.5, gy: 21.5, zoom: 0.6 }} w={1500} h={500} />
        <div style={VIGNETTE} />
        <div style={{
          position: 'absolute', right: 104, top: '50%', transform: 'translateY(-50%)',
          textAlign: 'right',
        }}
        >
          <Wordmark width={360} />
          <div style={{ ...TAG, fontSize: 16, marginTop: 16, color: '#e8b23c' }}>
            Forge · Muster · Conquer
          </div>
          <div style={{
            fontFamily: 'Arial', fontWeight: 900, fontSize: 17, letterSpacing: 1.4,
            color: '#c3d4ea', marginTop: 14,
          }}
          >
            ironvow.xyz
          </div>
        </div>
      </Frame>

      {/* 3 — the raid. The one screenshot that says what you do here. */}
      <Frame id="post-raid" w={1600} h={900}>
        <Hold
          w={1600}
          h={900}
          shot={{
            gx: 28,
            gy: 32.5,
            zoom: 0.7,
            /*
             * A line abreast, walking in.
             *
             * Spread along the screen's own horizontal axis, which is
             * `gx - gy` and not `gx`. The first attempt varied both and the
             * warband came out as one pile: seven figures inside two hundred
             * pixels, because moving a unit south-east on the grid barely moves
             * it sideways on screen at all. These hold `gx + gy` near seventy —
             * one rank, just south of the curtain — and step `gx - gy` by five
             * and a half, which is about a figure and a half apart.
             */
            units: [
              { type: 'ram', gx: 27.5, gy: 43.5, face: 1, swing: 0.85 },
              { type: 'raider', gx: 29.3, gy: 39.7, face: 1, swing: 0.95 },
              { type: 'archer', gx: 33.3, gy: 38.2, face: 1, swing: 0.35 },
              { type: 'lancer', gx: 34.8, gy: 34.2, face: 1, swing: 0.75 },
              { type: 'raider', gx: 38.5, gy: 32.5, face: 1, swing: 0.15 },
              { type: 'hero', gx: 40.5, gy: 29.0, face: 1, swing: 1 },
              { type: 'scaler', gx: 44.0, gy: 27.0, face: 1, swing: 0.55 },
            ],
          }}
        />
        <div style={VIGNETTE} />
        <div style={{ position: 'absolute', left: 66, top: 60 }}>
          <Wordmark width={300} />
        </div>
        <div style={{
          position: 'absolute', left: 66, right: 66, bottom: 58,
          ...PLATE, padding: '30px 38px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 30,
        }}
        >
          <div>
            <div style={{ ...TAG, fontSize: 17, color: '#e8b23c' }}>Raid real players</div>
            <div style={{
              fontFamily: 'Arial', fontWeight: 700, fontSize: 25, color: '#f2e4c4', marginTop: 12,
            }}
            >
              Scout the base. Drop your warband. Take three stars.
            </div>
          </div>
          <div style={{
            padding: '15px 30px', borderRadius: 14, whiteSpace: 'nowrap',
            background: 'linear-gradient(#e8b23c,#c4881f)', color: '#1a1206',
            fontFamily: 'Arial', fontWeight: 900, fontSize: 21, letterSpacing: 2,
          }}
          >
            IRONVOW.XYZ
          </div>
        </div>
      </Frame>

      {/* 4 — the square. What upgrading actually buys, which is the thing a
          screenshot of a menu can never say. */}
      <Frame id="post-troops" w={1080} h={1080}>
        {/* Close enough in that the edge of the plateau, and the flat backdrop
            past it, never come into frame behind the scrim. */}
        <Hold shot={{ gx: 28, gy: 28, zoom: 0.74 }} w={1080} h={1080} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,15,25,.74)' }} />
        <div style={{
          position: 'absolute', inset: 0, padding: '54px 52px 48px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
        >
          <Wordmark width={330} />
          <div style={{ ...TAG, fontSize: 16, marginTop: 18, color: '#e8b23c', textAlign: 'center' }}>
            Nine levels · every one a different soldier
          </div>

          <div style={{
            marginTop: 32, ...PLATE, padding: '26px 22px 22px', width: '100%',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
          }}
          >
            {TROOPS.map((t) => (
              <div key={t} style={{ textAlign: 'center' }}>
                <div style={{
                  background: 'linear-gradient(#31435f,#22304a)', border: '2px solid #46608a',
                  borderRadius: 16, padding: '12px 6px 9px',
                }}
                >
                  <TroopArt type={t} level={9} size={112} />
                  <div style={{
                    fontFamily: 'Arial', fontWeight: 900, fontSize: 13, letterSpacing: 1.4,
                    color: '#f2e4c4', marginTop: 8,
                  }}
                  >
                    {TROOP_NAME[t]}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 30, padding: '16px 34px', borderRadius: 14,
            background: 'linear-gradient(#e8b23c,#c4881f)', color: '#1a1206',
            fontFamily: 'Arial', fontWeight: 900, fontSize: 24, letterSpacing: 2.4,
          }}
          >
            IRONVOW.XYZ
          </div>
        </div>
      </Frame>
    </div>
  );
}
