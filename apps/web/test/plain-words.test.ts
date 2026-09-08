import { ITEM, NEWS, QUESTS, RELIC, SEASON_TIERS, TROOP, TYPES } from '@ironvow/config';
import { SECTIONS as HELP } from '../components/HelpSheet';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plain words only.
 *
 * ALFA, looking at the DEMOLISH button: "kata yang jarang d gunain di game" —
 * words games do not use. He was right about more than that one. The game had
 * a Keep, a Rampart, a Muster Field, a Vault, a warband and a hold, and every
 * one of them is a word a player has to stop and work out.
 *
 * These names are the first English many players will read in the game, so the
 * bar is not "is it correct" but "would somebody who has played one other base
 * builder already know what it means". This test is what stops a nice-sounding
 * archaic word creeping back in the next time a building is added.
 */

/**
 * Jargon: never acceptable anywhere a player reads.
 *
 * Each of these was a real name in the game until ALFA pointed at the SELL
 * button and said these are words games do not use.
 */
const JARGON = [
  'rampart', 'muster', 'warband', 'vault', 'brazier', 'bulwark', 'demolish', 'scaler',
];

/**
 * Words that are fine English but must never be a *name*.
 *
 * "Walls hold attackers inside cannon range" is plain and clear. "The Keep" as
 * the name of a building is not, and neither is "your hold" for your base. The
 * distinction is the noun, not the word.
 */
const NOT_A_NAME = ['hold', 'keep'];

/** Everything a player reads as a name or a one-line description. */
function facing(): { where: string; text: string; isName: boolean }[] {
  const out: { where: string; text: string; isName: boolean }[] = [];
  for (const [k, v] of Object.entries(TYPES)) {
    out.push({ where: `TYPES.${k}.n`, text: v.n, isName: true });
    out.push({ where: `TYPES.${k}.blurb`, text: v.blurb, isName: false });
  }
  for (const [k, v] of Object.entries(TROOP)) out.push({ where: `TROOP.${k}.n`, text: v.n, isName: true });
  for (const [k, v] of Object.entries(ITEM)) {
    out.push({ where: `ITEM.${k}.n`, text: v.n, isName: true });
    out.push({ where: `ITEM.${k}.d`, text: v.d, isName: false });
  }
  for (const [k, v] of Object.entries(RELIC)) {
    out.push({ where: `RELIC.${k}.n`, text: v.n, isName: true });
    out.push({ where: `RELIC.${k}.d`, text: v.d, isName: false });
  }
  for (const t of SEASON_TIERS) out.push({ where: `SEASON_TIERS.${t.id}.n`, text: t.n, isName: true });
  for (const q of QUESTS) {
    out.push({ where: `QUESTS.${q.id}.n`, text: q.n, isName: true });
    out.push({ where: `QUESTS.${q.id}.d`, text: q.d, isName: false });
  }
  for (const s of HELP) {
    out.push({ where: `HELP.${s.h}`, text: s.h, isName: false });
    for (const l of s.lines) out.push({ where: `HELP.${s.h}`, text: l, isName: false });
  }
  for (const n of NEWS) {
    // The one note that is *about* the rename has to print the words it
    // retired, or it cannot tell anybody what became of them.
    if (n.no === RENAME_NOTE) continue;
    out.push({ where: `NEWS.${n.no}.title`, text: n.title, isName: false });
    for (const l of n.lines) out.push({ where: `NEWS.${n.no}`, text: l, isName: false });
  }
  return out;
}

/** "Plainer words" — see NEWS. */
const RENAME_NOTE = 6;

/**
 * The other half, and the half that actually broke.
 *
 * Sweeping the config caught every *name*, and missed the scout sheet saying
 * "Keep 1 · 0 ramparts" for a week after both of those were renamed — because
 * that sentence is not a config value, it is typed into a component.
 *
 * What is checked is JSX text: the prose between the tags, which is exactly
 * what a player reads and nothing else. Not identifiers and not string
 * literals, because `TYPES.brazier` and `'demolish'` are a building key and a
 * prop name — database values and code, not words anybody is shown.
 */

/** Comments go first, newlines kept so a reported line number is the real one. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, before: string) => before);
}

/**
 * The prose between tags, with `{...}` expressions taken out.
 *
 * The lookbehind is the whole trick: `=>` ends in a `>` too, so without it an
 * arrow function reads as the start of a text node and `onDemolish={() =>
 * demolish(id)}` looks like a component printing the word demolish at a player.
 */
function jsxText(source: string): string {
  return withoutComments(source)
    .split('\n')
    .map((line) => (line.match(/(?<![=!<>-])>[^<>]*(?=<|$)/g) ?? [])
      .map((run) => run.slice(1).replace(/\{[^{}]*\}/g, ' '))
      .join(' '))
    .join('\n');
}

describe('what components print, not just what config holds', () => {
  const dir = join(__dirname, '..', 'components');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  it('has components to check at all', () => {
    // A sweep that quietly matches nothing is a test that quietly passes.
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(JARGON)('never prints "%s"', (word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    for (const f of files) {
      const lines = jsxText(readFileSync(join(dir, f), 'utf8')).split('\n');
      const at = lines.findIndex((l) => re.test(l));
      expect(at, `${f}:${at + 1} — ${lines[at] ?? ''}`).toBe(-1);
    }
  });

  it('reads building names from the config rather than typing them', () => {
    /*
     * The specific failure: the scout sheet spelled the old names out by hand,
     * so renaming the buildings changed everything except the one line a player
     * reads while deciding whether to attack.
     */
    const scout = readFileSync(join(dir, 'Modals.tsx'), 'utf8');
    expect(scout).toContain('TYPES.keep.n');
    expect(scout).toContain('TYPES.wall.n');
  });
});

describe('every name a player reads is a word games use', () => {
  it.each(JARGON)('never says "%s", anywhere', (word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    for (const { where, text } of facing()) {
      expect(re.test(text), `${where}: "${text}"`).toBe(false);
    }
  });

  it.each(NOT_A_NAME)('never names anything "%s"', (word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    for (const { where, text, isName } of facing()) {
      if (!isName) continue;
      expect(re.test(text), `${where}: "${text}"`).toBe(false);
    }
  });

  it('renamed the display names without touching a single stored key', () => {
    /*
     * The important half. Type keys are database values: every building row,
     * every saved layout and every frozen raid snapshot names its buildings by
     * these. Renaming one would break replays going back to launch.
     */
    for (const k of ['keep', 'store', 'camp', 'lab', 'tower', 'wall', 'snare', 'statue', 'brazier', 'standard'] as const) {
      expect(TYPES[k]).toBeDefined();
    }
    expect(TROOP.scaler).toBeDefined();
    expect(RELIC.bulwark).toBeDefined();
    expect(RELIC.edge).toBeDefined();
    expect(RELIC.haste).toBeDefined();
    expect(ITEM.horn).toBeDefined();
    expect(ITEM.firepot).toBeDefined();
    expect(SEASON_TIERS.map((t) => t.id)).toContain('iron_crown');
    expect(SEASON_TIERS.map((t) => t.id)).toContain('ember');
  });

  it('gives the names players expect from any base builder', () => {
    expect(TYPES.keep.n).toBe('Town Hall');
    expect(TYPES.wall.n).toBe('Wall');
    expect(TYPES.camp.n).toBe('Army Camp');
    expect(TYPES.store.n).toBe('Storage');
    expect(TYPES.lab.n).toBe('Laboratory');
    expect(TYPES.tower.n).toBe('Archer Tower');
    expect(TROOP.scaler.n).toBe('Climber');
  });
});
