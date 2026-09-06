import { IN0, IN1, N, TH, TW, ZOOM_MAX, ZOOM_MIN } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { snapZoom } from '../lib/render/camera';
import { generateTerrain } from '../lib/render/terrain';

/**
 * The grass is a canvas pattern drawn one device pixel to one. That is only
 * exact while a tile is a whole number of device pixels wide, which is what
 * the zoom snap guarantees — and what these tests hold it to.
 */
describe('snapZoom', () => {
  const dprs = [1, 1.5, 2, 2.625, 3];

  it('makes a tile a whole number of device pixels wide, and two rows tall', () => {
    for (const dpr of dprs) {
      for (let z = ZOOM_MIN; z <= ZOOM_MAX; z += 0.0137) {
        const q = snapZoom(z, dpr);
        const w = TW * q * dpr;
        expect(Math.abs(w - Math.round(w))).toBeLessThan(1e-6);
        // TH is TW / 2, so two rows are one tile width: whole as well.
        expect(Math.abs(2 * TH * q * dpr - Math.round(2 * TH * q * dpr))).toBeLessThan(1e-6);
      }
    }
  });

  it('stays inside the zoom limits', () => {
    for (const dpr of dprs) {
      expect(snapZoom(0, dpr)).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(snapZoom(99, dpr)).toBeLessThanOrEqual(ZOOM_MAX);
      expect(snapZoom(ZOOM_MAX, dpr)).toBeLessThanOrEqual(ZOOM_MAX);
      expect(snapZoom(ZOOM_MIN, dpr)).toBeGreaterThanOrEqual(ZOOM_MIN);
    }
  });

  it('moves the zoom by less than one percent', () => {
    for (const dpr of dprs) {
      for (const z of [0.5, 0.95, 1.3, 1.85]) {
        expect(Math.abs(snapZoom(z, dpr) - z) / z).toBeLessThan(0.01);
      }
    }
  });
});

describe('generateTerrain', () => {
  const t = generateTerrain();

  it('is the same map for every client', () => {
    const u = generateTerrain();
    expect(u.deco).toEqual(t.deco);
    expect(u.ground).toEqual(t.ground);
  });

  it('keeps the treeline off the plateau', () => {
    for (const d of t.deco) {
      const onField = d.gx >= 0 && d.gx < N && d.gy >= 0 && d.gy < N;
      expect(onField).toBe(false);
    }
  });

  it('keeps the ground cover on the plateau', () => {
    for (const g of t.ground) {
      expect(g.gx).toBeGreaterThanOrEqual(0);
      expect(g.gx).toBeLessThan(N);
      expect(g.gy).toBeGreaterThanOrEqual(0);
      expect(g.gy).toBeLessThan(N);
    }
  });

  it('marks the buildable square', () => {
    expect(t.tile[IN0 * N + IN0]).toBe(0);
    expect(t.tile[(IN1 - 1) * N + (IN1 - 1)]).toBe(0);
    expect(t.tile[0]).toBe(1);
    expect(t.tile[(IN0 - 1) * N + IN0]).toBe(1);
  });

  it('sorts the treeline back to front for the depth pass', () => {
    for (let i = 1; i < t.deco.length; i++) {
      expect(t.deco[i]!.gx + t.deco[i]!.gy).toBeGreaterThanOrEqual(t.deco[i - 1]!.gx + t.deco[i - 1]!.gy);
    }
  });
});
