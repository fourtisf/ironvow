import { TROOP, type TroopType } from '@ironvow/config';

/**
 * The training queue, resolved lazily.
 *
 * Jobs carry an absolute `finishesAt`, so nothing has to run while a player is
 * away: whatever has matured by the time they look is theirs. The queue is
 * sequential, exactly as in the prototype — a new job starts when the one in
 * front of it finishes, not when it was enqueued.
 */

export interface QueueJob {
  id: string;
  type: TroopType;
  finishesAt: Date;
  position: number;
}

export interface ResolveResult {
  /** Jobs that have matured and should be deleted. */
  finished: QueueJob[];
  /** Troop counts to add, by type. */
  gained: Partial<Record<TroopType, number>>;
  /** Jobs still cooking, in order. */
  pending: QueueJob[];
}

export function resolveQueue(jobs: readonly QueueJob[], now: Date): ResolveResult {
  const ordered = [...jobs].sort((a, b) => a.position - b.position);
  const finished: QueueJob[] = [];
  const pending: QueueJob[] = [];
  const gained: Partial<Record<TroopType, number>> = {};

  for (const job of ordered) {
    if (job.finishesAt.getTime() <= now.getTime()) {
      finished.push(job);
      gained[job.type] = (gained[job.type] ?? 0) + 1;
    } else {
      pending.push(job);
    }
  }
  return { finished, gained, pending };
}

/**
 * When a newly enqueued job will finish.
 *
 * It starts when the last job in the queue does, or now if the queue is empty.
 * Using the tail's finish time rather than a running clock is what makes the
 * queue survive a server restart with no reconciliation.
 */
export function nextFinishAt(pending: readonly QueueJob[], type: TroopType, now: Date): Date {
  let start = now.getTime();
  for (const job of pending) start = Math.max(start, job.finishesAt.getTime());
  return new Date(start + TROOP[type].tt * 1000);
}

export function nextPosition(pending: readonly QueueJob[]): number {
  let max = -1;
  for (const job of pending) max = Math.max(max, job.position);
  return max + 1;
}
