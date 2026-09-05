/**
 * Music.
 *
 * Generated at runtime like everything else in IRONVOW — no audio files, no
 * loading, nothing added to the download. That is the same reason the art is
 * drawn rather than shipped, and it means the soundtrack costs about two
 * kilobytes instead of two megabytes.
 *
 * The approach is a small sequencer rather than a loop: a slow chord
 * progression in natural minor, a bass note on each change, a sparse melody
 * picked from the current chord, and a heartbeat that only appears in battle.
 * Because the notes are chosen rather than recorded, nothing ever repeats
 * exactly, which is what stops it grating after twenty minutes.
 */

export type MusicMood = 'base' | 'battle';

const STORAGE_MUSIC = 'ironvow_music_volume';

/** A minor for the hold, D minor for a raid: same shape, darker footing. */
const ROOTS: Record<MusicMood, number> = { base: 220, battle: 146.83 };

/** Natural minor, in semitones. */
const SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];

/** i — VI — III — VII, the progression every siege has ever been scored with. */
const PROGRESSION = [0, 5, 2, 6];

const semitone = (root: number, steps: number): number => root * Math.pow(2, steps / 12);

interface Voice {
  ctx: AudioContext;
  master: GainNode;
}

let voice: Voice | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let mood: MusicMood = 'base';
let volume = 0.35;
let running = false;
/** Bars played, which drives where the progression is. */
let bar = 0;

export function musicVolume(): number {
  return volume;
}

export function setMusicVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
  if (voice) voice.master.gain.value = volume * 0.16;
  try {
    localStorage.setItem(STORAGE_MUSIC, String(volume));
  } catch {
    // Private browsing refuses storage; the setting just will not persist.
  }
  if (volume === 0) stopMusic();
}

export function loadMusicPreference(): number {
  try {
    const saved = localStorage.getItem(STORAGE_MUSIC);
    if (saved !== null) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed)) volume = Math.max(0, Math.min(1, parsed));
    }
  } catch {
    // Fall back to the default.
  }
  return volume;
}

function ensureVoice(): Voice | null {
  if (voice) return voice;
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = volume * 0.16;
    master.connect(ctx.destination);
    voice = { ctx, master };
  } catch {
    voice = null;
  }
  return voice;
}

/** One note. `type` and the envelope are what separate a pad from a pluck. */
function note(
  v: Voice, freq: number, at: number, dur: number,
  type: OscillatorType, gain: number, detune = 0,
): void {
  const osc = v.ctx.createOscillator();
  const env = v.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;

  // A slow attack for pads, a fast one for plucks, and always an exponential
  // release: a linear one sounds like the sound being switched off.
  const attack = type === 'sine' || type === 'triangle' ? dur * 0.25 : 0.02;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(env);
  env.connect(v.master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** A soft thud, for the battle heartbeat. No sample, just a falling sine. */
function thud(v: Voice, at: number, gain: number): void {
  const osc = v.ctx.createOscillator();
  const env = v.ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.16);
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
  osc.connect(env);
  env.connect(v.master);
  osc.start(at);
  osc.stop(at + 0.3);
}

/** Schedules one bar and queues the next. */
function playBar(): void {
  const v = ensureVoice();
  if (!v || !running) return;

  const battle = mood === 'battle';
  const root = ROOTS[mood];
  const barSeconds = battle ? 2.0 : 2.8;
  const at = v.ctx.currentTime + 0.06;
  const degree = PROGRESSION[bar % PROGRESSION.length]!;

  // Bass: the root of the chord, long and quiet, holding the floor.
  note(v, semitone(root, SCALE[degree]! - 12), at, barSeconds * 0.98, 'triangle', 0.5);

  // Pad: a third and a fifth above, slightly detuned against each other so the
  // chord breathes instead of sitting still.
  note(v, semitone(root, SCALE[degree]!), at, barSeconds * 0.94, 'sine', 0.22, -6);
  note(v, semitone(root, SCALE[(degree + 2) % SCALE.length]!), at, barSeconds * 0.94, 'sine', 0.18, 7);

  // Melody: two or three notes from the chord tones, placed on off-beats.
  // Chosen fresh each bar, so the piece never repeats exactly.
  const notes = battle ? 4 : 3;
  for (let i = 0; i < notes; i++) {
    if (Math.random() > (battle ? 0.85 : 0.6)) continue;
    const step = SCALE[(degree + 2 * (1 + Math.floor(Math.random() * 3))) % SCALE.length]!;
    const offset = (barSeconds / notes) * (i + (battle ? 0.5 : 0.25));
    note(v, semitone(root, step + 12), at + offset, battle ? 0.28 : 0.5, 'triangle', 0.09);
  }

  // A raid gets a pulse. The hold does not: silence is what makes the base feel
  // like somewhere you are safe.
  if (battle) {
    thud(v, at, 0.5);
    thud(v, at + barSeconds * 0.5, 0.32);
    if (bar % 2 === 1) thud(v, at + barSeconds * 0.75, 0.2);
  }

  bar++;
  timer = setTimeout(playBar, barSeconds * 1000);
}

/**
 * Start, or switch mood.
 *
 * Must be reached from a real gesture the first time: browsers keep an
 * AudioContext suspended until the user has interacted with the page.
 */
export function startMusic(next: MusicMood = 'base'): void {
  if (volume === 0) return;
  const v = ensureVoice();
  if (!v) return;
  if (v.ctx.state === 'suspended') void v.ctx.resume();

  if (running && mood === next) return;
  // Reset the progression on a mood change so a raid opens on the root chord.
  if (mood !== next) bar = 0;
  mood = next;

  if (!running) {
    running = true;
    playBar();
  }
}

export function stopMusic(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Called on the first tap, alongside the sound-effect unlock. */
export function unlockMusic(): void {
  const v = ensureVoice();
  if (v && v.ctx.state === 'suspended') void v.ctx.resume();
}
