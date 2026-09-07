/** The prototype's number formatting, unchanged: 1.2K, 34K, 1.4M. */
export function fmt(n: number): string {
  const v = Math.floor(n);
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(0) + 'K';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "in 2m 30s", for a training job or a shield. */
export function until(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'ready';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * A long wait, in the largest two units that are not zero.
 *
 * `until` tops out at hours, which is right for a builder and useless for a
 * season: "336h 12m" is a number nobody converts in their head. Anything under
 * a day falls through to `until`, so the last day of a season counts down in
 * hours and minutes like everything else in the game.
 */
export function longUntil(ms: number): string {
  if (ms <= 0) return 'over';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1_440);
  if (days < 1) return until(new Date(Date.now() + ms).toISOString());
  const hours = Math.floor((mins % 1_440) / 60);
  return `${days}d ${hours}h`;
}
