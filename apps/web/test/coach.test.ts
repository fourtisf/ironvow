import { DAILY_POOL } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { TUTORIAL, goFor, nextObjective } from '../lib/game/coach';
import type { QuestRow } from '../components/QuestSheet';

/**
 * The guide shows one objective, in a fixed order: the tutorial, then the
 * campaign, then today's orders, then rest. If that order ever slipped, a new
 * player would be told to win five raids before being told how to collect.
 */

const quest = (id: string, progress: number, goal: number, claimed = false): QuestRow => ({
  id, name: id, detail: '', goal, reward: { g: 10, i: 0 }, progress, claimed,
});

const daily = (orders: { id: string; progress: number; goal: number; claimed?: boolean }[]) => ({
  count: orders.length,
  streak: 3,
  resetsInMs: 3_600_000,
  orders: orders.map((o) => ({
    id: o.id, name: o.id, detail: '', goal: o.goal, reward: { g: 10, i: 0 },
    progress: o.progress, claimed: o.claimed ?? false,
  })),
});

describe('nextObjective', () => {
  it('starts with the tutorial, step by step', () => {
    const first = nextObjective({ tutorialDone: [], quests: [quest('q1', 0, 3)], daily: null });
    expect(first.kind).toBe('tutorial');
    expect(first.id).toBe(TUTORIAL[0]!.id);
    const second = nextObjective({ tutorialDone: [TUTORIAL[0]!.id], quests: [], daily: null });
    expect(second.id).toBe(TUTORIAL[1]!.id);
  });

  it('then walks the campaign in order and knows where each order is done', () => {
    const done = TUTORIAL.map((s) => s.id);
    const o = nextObjective({ tutorialDone: done, quests: [quest('q1', 3, 3, true), quest('q2', 1, 2), quest('q5', 0, 1)], daily: null });
    expect(o.kind).toBe('quest');
    expect(o.id).toBe('q2');
    expect(o.go).toBe('build');
    expect(o.target).toBe('build');
    expect(o.claimable).toBe(false);
    expect(o.progress).toBe(1);
  });

  it('offers CLAIM when the server says the order is met', () => {
    const done = TUTORIAL.map((s) => s.id);
    const o = nextObjective({ tutorialDone: done, quests: [quest('q1', 5, 3)], daily: null });
    expect(o.claimable).toBe(true);
    expect(o.go).toBeNull();
    expect(o.progress).toBe(3);
  });

  it('moves on to today once the campaign is claimed', () => {
    const done = TUTORIAL.map((s) => s.id);
    const o = nextObjective({
      tutorialDone: done,
      quests: [quest('q1', 3, 3, true)],
      daily: daily([{ id: 'd-collect-8', progress: 8, goal: 8, claimed: true }, { id: 'd-train-12', progress: 4, goal: 12 }]),
    });
    expect(o.kind).toBe('daily');
    expect(o.id).toBe('d-train-12');
    expect(o.go).toBe('army');
    expect(o.label).toContain('2 OF 2');
    expect(o.label).toContain('3 DAYS');
  });

  it('rests when everything is claimed, and still has somewhere to send you', () => {
    const done = TUTORIAL.map((s) => s.id);
    const o = nextObjective({
      tutorialDone: done,
      quests: [quest('q1', 3, 3, true)],
      daily: daily([{ id: 'd-collect-8', progress: 8, goal: 8, claimed: true }]),
    });
    expect(o.kind).toBe('rest');
    expect(o.go).toBe('raid');
    expect(o.text).toContain('1h 0m');
  });
});

describe('goFor', () => {
  it('has a destination for every order in both pools', () => {
    for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12']) {
      expect(goFor('quest', id)).not.toBeNull();
    }
    for (const d of DAILY_POOL) expect(goFor('daily', d.id)).not.toBeNull();
  });
});
