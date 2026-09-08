/** The prototype's colour set, unchanged. All art is drawn from these. */
export const C = {
  grass: '#6ea844',
  /** The other square of the checkerboard. */
  grassB: '#77b34b',
  /** The turf overhanging the cliff. */
  grassLip: '#5c9438',
  /** The lower ground around the plateau. */
  apron: '#5f9540',
  apronB: '#659d44',
  /** The cut face of the plateau, lit and shaded. */
  earth: '#8a6a45',
  earthD: '#6b5236',
  grass2: '#7cb84e',
  grass3: '#63993d',
  dirt: '#b4854a',
  dirt2: '#9c6f3b',
  forest: '#2c5c33',
  forestD: '#1d4023',
  iron: '#1b2432',
  gold: '#e8b23c',
  goldD: '#a8761b',
  parch: '#f2e4c4',
  blood: '#c2412d',
  stone: '#8d9aa8',
  stoneD: '#5f6d7d',
  stoneL: '#b6c2cd',
  wood: '#8a5a30',
  woodD: '#5d3b1e',
  line: '#141c28',
} as const;

export const bannerColor = (enemy: boolean): string => (enemy ? '#c2412d' : '#3f7fd6');

/** Vertical offset of the level pip above each building type. */
/**
 * Vertical offset of the level pip above each building type.
 *
 * Multiplied by the level's growth in `pipHeightOf`, so a pip stays clear of
 * a building that gets taller as it is upgraded. The mine's headframe and the
 * forge's chimneys are what set those two.
 */
export const PIPH: Record<string, number> = {
  keep: 172, mine: 96, forge: 112, store: 82, barr: 122, camp: 66, lab: 108, cannon: 56, tower: 132, mortar: 62, airdef: 96, spike: 26, snare: 26, wall: 0,
  statue: 128, brazier: 58, standard: 96,
};
