/**
 * The light on the field, and what time it is where the player is.
 *
 * ALFA: "kaya pagi siang sore malam".
 *
 * A base that looks identical at seven in the morning and eleven at night is a
 * base nobody feels they live in. This is what makes opening the game before
 * school different from opening it in bed, and it costs nothing to run: the
 * whole effect is one fixed element the compositor blends over the canvas, so
 * no frame does any extra work and no sprite is redrawn.
 *
 * That last part is the constraint the whole design turns on. Buildings and
 * troops are rasterised once into a cache keyed on their shape, so a painter
 * that read the clock would bake one moment of one day into every copy of that
 * building for good — see RENDER_NOTE in `lib/render/buildings.ts`. The light
 * therefore lives entirely above the canvas and never inside it.
 *
 * It is also purely cosmetic. Nothing here reaches the simulation: a raid at
 * midnight resolves exactly as it would at noon, and two people watching the
 * same shared replay in different time zones watch the same fight under
 * different skies.
 */

/** The four the player was thinking of, in the game's own words. */
export const PHASES = ['morning', 'day', 'sunset', 'night'] as const;
export type Phase = (typeof PHASES)[number];

/** What the player asked for: a phase, or `auto` to follow their own clock. */
export type SkySetting = Phase | 'auto';

const STORAGE_KEY = 'ironvow_sky';

/** What each phase is called on screen. */
export const PHASE_NAME: Record<Phase, string> = {
  morning: 'Morning',
  day: 'Day',
  sunset: 'Sunset',
  night: 'Night',
};

/**
 * The hour a phase begins, on the player's own clock.
 *
 * Local time on purpose. The point is that the game agrees with the window next
 * to the player, and UTC would put half the world's evening at breakfast.
 */
export function phaseAt(now = new Date()): Phase {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'sunset';
  return 'night';
}

/** The phase actually shown: the setting, unless the setting is to follow the clock. */
export function phaseFor(setting: SkySetting, now = new Date()): Phase {
  return setting === 'auto' ? phaseAt(now) : setting;
}

/**
 * How long until the sky should change, in milliseconds.
 *
 * So the page can wait exactly that long instead of asking the clock every
 * frame for something that answers the same four ways all day.
 */
export function msUntilNextPhase(now = new Date()): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  do {
    next.setHours(next.getHours() + 1);
  } while (phaseAt(next) === phaseAt(now));
  return next.getTime() - now.getTime();
}

/** The order the settings button walks through: follow the clock, then each phase. */
export const SKY_ORDER: SkySetting[] = ['auto', ...PHASES];

export function nextSky(current: SkySetting): SkySetting {
  const i = SKY_ORDER.indexOf(current);
  return SKY_ORDER[(i + 1) % SKY_ORDER.length]!;
}

/** What the settings row says about the current choice. */
export function skyLabel(setting: SkySetting, now = new Date()): string {
  return setting === 'auto'
    ? `Follows your clock · ${PHASE_NAME[phaseAt(now)].toLowerCase()} right now`
    : `Always ${PHASE_NAME[setting].toLowerCase()}`;
}

export function loadSky(): SkySetting {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null && (SKY_ORDER as string[]).includes(saved)) return saved as SkySetting;
  } catch {
    // A browser that will not store preferences still gets a sky.
  }
  return 'auto';
}

export function saveSky(setting: SkySetting): void {
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // It will follow the clock again next time. Nothing is lost.
  }
}

/**
 * What each phase does to the field.
 *
 * Two layers, and the order they are painted in is the whole reason this lives
 * on the canvas rather than in a stylesheet. `darken` multiplies the scene
 * down, and the Torches are painted *after* it, adding light back into a screen
 * that is already dark. Done as a DOM layer over the canvas, the overlay would
 * fall on the fire as well and a torch could never light anything.
 *
 * `wash` is the colour of the light rather than its amount — soft-light, so it
 * tints without flattening the art the way a plain fill does.
 */
export interface SkyTint {
  /** Two rgba stops, drawn corner to corner across the screen. */
  from: string;
  to: string;
}

/**
 * What each phase does to the field: one gradient, laid over the finished
 * scene, and that is the whole of it.
 *
 * It was two passes to begin with — a `multiply` for how much light there is
 * and a `soft-light` for what colour it is, which is how you would actually
 * light a scene. Measured on a throttled phone, night cost 83 ms a frame
 * against day's 33: two full-screen fills in blend modes the canvas has no fast
 * path for, on a renderer that fills every pixel on the CPU. Atmosphere is not
 * worth halving the frame rate of the people on the slowest phones, so the
 * darkening and the colour are baked into the alpha of one plain gradient. A
 * `source-over` fill is the cheapest thing a canvas can do.
 *
 * The stops carry their own alpha, so the light can be heavier at one side of
 * the sky than the other — which is what stops a low sun reading as a filter.
 */
export const SKY: Record<Phase, SkyTint> = {
  // Cool and clean. Light, because morning is bright — just not warm yet.
  morning: { from: 'rgba(255,236,196,0.15)', to: 'rgba(170,208,255,0.17)' },
  // Midday is the art exactly as it was drawn. Nothing is added to it.
  day: { from: 'rgba(0,0,0,0)', to: 'rgba(0,0,0,0)' },
  // The hour the game looks best: warm from one side, cooling to the other.
  sunset: { from: 'rgba(255,146,40,0.30)', to: 'rgba(92,40,108,0.38)' },
  // Dark enough to be night, blue rather than black, so the greens stay green
  // instead of washing out to concrete.
  night: { from: 'rgba(26,40,102,0.60)', to: 'rgba(7,12,42,0.68)' },
};

/** How long a change of light takes, in seconds. */
export const SKY_FADE = 1.4;

/**
 * How dark it is, from 0 in daylight to 1 at night.
 *
 * The one number the canvas is allowed to know about the hour, and it exists
 * for one thing: a Torch casts light on the ground when there is dark for it to
 * push back. `TYPES.brazier.blurb` has promised "a fire that burns all night"
 * since it was written, against a game that had no night in it.
 */
export function nightLevel(phase: Phase): number {
  return phase === 'night' ? 1 : phase === 'sunset' ? 0.4 : 0;
}

/**
 * Follow the sky: now, when the hour turns, and when the player changes it.
 *
 * One implementation because there are two consumers — the element that tints
 * the screen and the canvas that lights the torches — and two timers that are
 * meant to agree about what time it is are two timers that will not.
 */
export const SKY_EVENT = 'ironvow:sky';

export function watchPhase(onPhase: (phase: Phase) => void): () => void {
  let timer = 0;

  const settle = (setting: SkySetting): void => {
    onPhase(phaseFor(setting));
    window.clearTimeout(timer);
    // Only `auto` has anything to wait for; a phase the player pinned never
    // expires. The extra second is so a timer that fires a hair early does not
    // read the old hour and schedule itself again for no time at all.
    if (setting !== 'auto') return;
    timer = window.setTimeout(() => settle('auto'), msUntilNextPhase() + 1_000);
  };

  settle(loadSky());
  const onChange = (e: Event): void => settle((e as CustomEvent<SkySetting>).detail);
  window.addEventListener(SKY_EVENT, onChange);

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener(SKY_EVENT, onChange);
  };
}

/** Tell every watcher the player changed their mind, from wherever the switch is. */
export function announceSky(setting: SkySetting): void {
  window.dispatchEvent(new CustomEvent(SKY_EVENT, { detail: setting }));
}
