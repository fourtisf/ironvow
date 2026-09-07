/**
 * Music.
 *
 * Generated at runtime like everything else in IRONVOW — no audio files, no
 * loading, nothing added to the download. That is the same reason the art is
 * drawn rather than shipped: the soundtrack costs about four kilobytes rather
 * than four megabytes.
 *
 * The first version of this was bad, and it is worth writing down why, because
 * all three faults are the ones generative game music usually has:
 *
 *  1. **The melody was random.** Notes were picked from the chord each bar so
 *     that "nothing ever repeats exactly". That is precisely backwards. Music
 *     is memorable because it repeats: a phrase you have heard before coming
 *     back, changed a little. Random notes over a chord are not a tune, they
 *     are noodling, and twenty minutes of them is worse than silence. The
 *     themes below are written out, note by note, and varied by transposition
 *     and ornament rather than by dice.
 *  2. **The chords were not chords.** The pad voiced `SCALE[degree]` and
 *     `SCALE[degree + 2]`, which is a third only when the degree happens to
 *     land right; at the sixth it was an octave. Triads are built properly
 *     here, by stacking scale degrees.
 *  3. **Everything was a bare oscillator.** A sine with an envelope is a test
 *     tone. Real timbre comes from detuning two voices against each other,
 *     moving a filter through the note, and putting the lot in a room — so
 *     there is a reverb, and the instruments below are small stacks rather
 *     than single oscillators.
 *
 * And one that is not about notes at all: bars were scheduled with
 * `setTimeout`, which drifts by tens of milliseconds. Timing jitter is heard
 * as sloppiness even by people who cannot name what is wrong. This runs a
 * lookahead scheduler instead — a cheap timer that queues events onto the
 * audio clock a fraction of a second ahead, which is sample-accurate.
 *
 * The music is modal rather than major/minor, which is what makes it sound
 * medieval: the hold is in D Dorian, the raid in D Aeolian. Same tonic, one
 * note different, and that note is the whole difference between a village at
 * peace and one at war.
 */

export type MusicMood = 'base' | 'battle';

const STORAGE_MUSIC = 'ironvow_music_volume';

/* ------------------------------------------------------------- theory --- */

/** D, four octaves down from the top of the piano. Everything is relative. */
const TONIC = 146.83;

/**
 * Dorian for the hold, Aeolian for the raid.
 *
 * They differ in one note — the sixth, B against B flat — and that single
 * semitone is the difference between the open, hopeful sound of a working
 * village and the closed one of a siege. It is why both moods can share a
 * tonic and still feel like different pieces.
 */
const MODES: Record<MusicMood, readonly number[]> = {
  base: [0, 2, 3, 5, 7, 9, 10],
  battle: [0, 2, 3, 5, 7, 8, 10],
};

/** Degree to frequency, wrapping octaves. Degree 7 is the tonic, an octave up. */
function pitch(mood: MusicMood, degree: number): number {
  const mode = MODES[mood];
  const octave = Math.floor(degree / mode.length);
  const step = mode[((degree % mode.length) + mode.length) % mode.length]!;
  return TONIC * Math.pow(2, (step + 12 * octave) / 12);
}

/** A note in a written phrase: scale degree, then length in beats. */
type Step = readonly [degree: number, beats: number];
/** A rest. Degree is meaningless; the length still advances the clock. */
const REST = -99;

interface Section {
  bpm: number;
  beatsPerBar: number;
  /** Chord roots as scale degrees, one per bar. The loop is this long. */
  chords: readonly number[];
  /** The tune, laid over the chords from the first bar. */
  melody: readonly Step[];
}

/**
 * The hold.
 *
 * Slow, in 4, and the melody rises through the first half and falls home
 * through the second — the oldest shape there is, and the reason it can be
 * hummed after one listen. The chords are i–VII–IV–i, which in Dorian gives
 * Dm–C–G–Dm: the major fourth against a minor tonic is the sound people mean
 * when they say "medieval".
 */
const HOLD: Section = {
  bpm: 68,
  beatsPerBar: 4,
  chords: [0, 6, 3, 0, 3, 6, 4, 0],
  melody: [
    [7, 2], [6, 1], [7, 1],
    [9, 2], [7, 2],
    [6, 1], [7, 1], [9, 2],
    [7, 3], [REST, 1],
    [9, 2], [10, 1], [11, 1],
    [12, 2], [9, 2],
    [10, 1], [9, 1], [7, 1], [6, 1],
    [7, 3], [REST, 1],
  ],
};

/**
 * The raid.
 *
 * Twice the tempo, half the loop, and the melody is built from a repeated note
 * rather than a rising line — a call, not a song. i–VI–VII–i, which is the
 * progression every siege has ever been scored with, because the flat seventh
 * pulling back to the tonic is what marching sounds like.
 */
const WAR: Section = {
  bpm: 132,
  beatsPerBar: 4,
  chords: [0, 5, 6, 0],
  melody: [
    [7, 0.5], [7, 0.5], [9, 1], [7, 1], [6, 1],
    [11, 2], [9, 2],
    [10, 1], [9, 1], [7, 1], [9, 1],
    [7, 2], [REST, 2],
  ],
};

const SECTIONS: Record<MusicMood, Section> = { base: HOLD, battle: WAR };

/* ---------------------------------------------------------------- rig --- */

interface Rig {
  ctx: AudioContext;
  /** Everything lands here; the volume slider moves this. */
  master: GainNode;
  /** Dry path, and the send into the room. */
  dry: GainNode;
  send: GainNode;
}

let rig: Rig | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let mood: MusicMood = 'base';
let volume = 0.35;
let running = false;

/** Where the sequencer has got to, on the audio clock. */
let nextBarAt = 0;
/** Bars played since the mood last changed, which is where the loop is. */
let bar = 0;

/** How far ahead events are queued, and how often the queue is topped up. */
const LOOKAHEAD_SECONDS = 0.4;
const TICK_MS = 40;

export function musicVolume(): number {
  return volume;
}

export function setMusicVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
  if (rig) rig.master.gain.value = volume * 0.5;
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

/**
 * A room, built from noise.
 *
 * Two and a half seconds of decaying noise convolved with everything on the
 * send is what turns a stack of oscillators into something that sounds like it
 * is being played somewhere. It is the single cheapest thing that separates a
 * game soundtrack from a test tone.
 */
function makeRoom(ctx: AudioContext): ConvolverNode {
  const seconds = 2.4;
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      // A short burst of early reflections, then a long exponential tail.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < 700 ? 0.6 : 1);
    }
  }
  const node = ctx.createConvolver();
  node.buffer = buffer;
  return node;
}

function ensureRig(): Rig | null {
  if (rig) return rig;
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.value = volume * 0.5;

    // A gentle compressor across the mix, so a chord landing on a drum does
    // not clip and the whole thing keeps an even level as parts come and go.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 22;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.22;

    const dry = ctx.createGain();
    dry.gain.value = 0.82;
    const send = ctx.createGain();
    send.gain.value = 0.3;
    const room = makeRoom(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;

    dry.connect(master);
    send.connect(room);
    room.connect(wet);
    wet.connect(master);
    master.connect(glue);
    glue.connect(ctx.destination);

    rig = { ctx, master, dry, send };
  } catch {
    rig = null;
  }
  return rig;
}

/** Route one voice into the mix, wetter or drier depending on what it is. */
function out(r: Rig, node: AudioNode, wetness: number): void {
  node.connect(r.dry);
  if (wetness > 0) {
    const tap = r.ctx.createGain();
    tap.gain.value = wetness;
    node.connect(tap);
    tap.connect(r.send);
  }
}

/* -------------------------------------------------------- instruments --- */

/**
 * A plucked string: lute, harp, whatever the hold has.
 *
 * Two detuned triangles through a bandpass that falls through the note. The
 * falling filter is the pluck — a fixed one sounds like a bell.
 */
function pluck(r: Rig, freq: number, at: number, dur: number, gain: number): void {
  const env = r.ctx.createGain();
  const filter = r.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.6;
  filter.frequency.setValueAtTime(freq * 5, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.2), at + dur * 0.7);

  for (const detune of [-5, 6]) {
    const osc = r.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  filter.connect(env);
  out(r, env, 0.5);
}

/**
 * Strings: two saws a few cents apart, opened by a slow filter.
 *
 * The detuning is the whole trick. One saw is a buzz; two of them beating
 * against each other at six cents is a section.
 */
function strings(r: Rig, freq: number, at: number, dur: number, gain: number): void {
  const env = r.ctx.createGain();
  const filter = r.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(freq * 1.6, at);
  filter.frequency.linearRampToValueAtTime(freq * 4.5, at + dur * 0.45);
  filter.frequency.linearRampToValueAtTime(freq * 2, at + dur);

  for (const detune of [-7, 7]) {
    const osc = r.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + dur + 0.1);
  }

  const rise = Math.min(0.5, dur * 0.35);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + rise);
  env.gain.setValueAtTime(gain, at + dur * 0.75);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  filter.connect(env);
  out(r, env, 0.75);
}

/**
 * A horn: a sawtooth with the top taken off, breathed in, and given a slow
 * vibrato once the note has settled. The vibrato is what stops a long note
 * sounding like a held key.
 */
function horn(r: Rig, freq: number, at: number, dur: number, gain: number): void {
  const osc = r.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;

  const vib = r.ctx.createOscillator();
  vib.frequency.value = 5.2;
  const vibAmount = r.ctx.createGain();
  vibAmount.gain.setValueAtTime(0, at);
  vibAmount.gain.linearRampToValueAtTime(7, at + Math.min(0.6, dur * 0.5));
  vib.connect(vibAmount);
  vibAmount.connect(osc.detune);
  vib.start(at);
  vib.stop(at + dur + 0.1);

  const filter = r.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 2, at);
  filter.frequency.linearRampToValueAtTime(freq * 3.4, at + dur * 0.3);

  const env = r.ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.09);
  env.gain.setValueAtTime(gain, at + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(filter);
  filter.connect(env);
  out(r, env, 0.45);
  osc.start(at);
  osc.stop(at + dur + 0.1);
}

/** The floor: a sine sub with a triangle over it so it reads on a phone. */
function bass(r: Rig, freq: number, at: number, dur: number, gain: number): void {
  const env = r.ctx.createGain();
  for (const [type, mul, level] of [['sine', 1, 1], ['triangle', 2, 0.28]] as const) {
    const osc = r.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq * mul;
    const g = r.ctx.createGain();
    g.gain.value = level;
    osc.connect(g);
    g.connect(env);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  out(r, env, 0.12);
}

/** A war drum: a pitch falling fast, with a little noise on the strike. */
function drum(r: Rig, at: number, gain: number, from = 165, to = 48): void {
  const osc = r.ctx.createOscillator();
  const env = r.ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + 0.14);
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  osc.connect(env);
  out(r, env, 0.2);
  osc.start(at);
  osc.stop(at + 0.4);
}

/** Noise through a filter: a snare when narrow, a cymbal when open. */
function noise(r: Rig, at: number, gain: number, kind: 'snare' | 'hat' | 'crash'): void {
  const dur = kind === 'crash' ? 1.1 : kind === 'hat' ? 0.05 : 0.16;
  const frames = Math.max(1, Math.floor(r.ctx.sampleRate * dur));
  const buffer = r.ctx.createBuffer(1, frames, r.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = r.ctx.createBufferSource();
  src.buffer = buffer;
  const filter = r.ctx.createBiquadFilter();
  if (kind === 'snare') { filter.type = 'bandpass'; filter.frequency.value = 1900; filter.Q.value = 0.7; }
  else if (kind === 'hat') { filter.type = 'highpass'; filter.frequency.value = 7000; }
  else { filter.type = 'highpass'; filter.frequency.value = 3200; }

  const env = r.ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter);
  filter.connect(env);
  out(r, env, kind === 'crash' ? 0.8 : 0.3);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/* ---------------------------------------------------------- sequencer --- */

/** Where a melody step falls, in beats from the start of the loop. */
function melodyAt(section: Section, beat: number): { degree: number; beats: number } | null {
  let cursor = 0;
  for (const [degree, beats] of section.melody) {
    if (Math.abs(cursor - beat) < 1e-6) return { degree, beats };
    cursor += beats;
    if (cursor > beat) return null;
  }
  return null;
}

/** Total beats in one pass of the melody, which is also the loop length. */
function loopBeats(section: Section): number {
  return section.chords.length * section.beatsPerBar;
}

/** Schedule one bar of whichever section is playing. */
function scheduleBar(r: Rig, at: number): void {
  const section = SECTIONS[mood];
  const beat = 60 / section.bpm;
  const bars = section.chords.length;
  const index = bar % bars;
  const root = section.chords[index]!;
  const barBeats = section.beatsPerBar;
  const barSeconds = barBeats * beat;
  const battle = mood === 'battle';

  /*
   * A real triad, built by stacking scale degrees rather than semitones.
   * Doing it in the mode is what keeps every chord diatonic: the third is
   * minor or major depending on where in the mode it sits, which is the whole
   * character of modal writing and exactly what the old version lost.
   */
  const triad = [root, root + 2, root + 4];

  // The floor. In the hold it is one long note a bar; in a raid it drives.
  bass(r, pitch(mood, root - 7), at, battle ? beat * 0.9 : barSeconds * 0.92, battle ? 0.42 : 0.3);
  if (battle) {
    for (let i = 1; i < barBeats; i++) {
      bass(r, pitch(mood, root - 7), at + i * beat, beat * 0.55, i % 2 === 0 ? 0.34 : 0.2);
    }
  }

  // Strings hold the chord under everything.
  for (let i = 0; i < triad.length; i++) {
    strings(r, pitch(mood, triad[i]!), at, barSeconds * (battle ? 0.9 : 0.98), battle ? 0.05 : 0.062);
  }

  // A horn on the chord change, and only there: it is an announcement, and an
  // announcement every bar is a drone.
  if (index % 2 === 0) {
    horn(r, pitch(mood, root), at + beat * 0.02, barSeconds * (battle ? 0.8 : 1.6), battle ? 0.08 : 0.055);
  }

  // The tune.
  for (let b = 0; b < barBeats; b += 0.5) {
    const step = melodyAt(section, index * barBeats + b);
    if (!step || step.degree === REST) continue;
    const dur = Math.min(step.beats * beat * 0.96, barSeconds);
    if (battle) {
      // Doubled an octave down by a horn: a war theme has to have weight.
      pluck(r, pitch(mood, step.degree), at + b * beat, dur, 0.14);
      horn(r, pitch(mood, step.degree - 7), at + b * beat, dur * 0.9, 0.05);
    } else {
      pluck(r, pitch(mood, step.degree), at + b * beat, dur, 0.11);
    }
  }

  if (battle) {
    // A march: drum on one and three, snare on two and four, a driving
    // eighth-note pulse under it, and a crash where the loop comes round.
    drum(r, at, 0.6);
    drum(r, at + beat * 2, 0.44);
    if (index === bars - 1) drum(r, at + beat * 3.5, 0.4, 200, 60);
    noise(r, at + beat, 0.14, 'snare');
    noise(r, at + beat * 3, 0.13, 'snare');
    for (let i = 0; i < barBeats * 2; i++) {
      noise(r, at + i * beat * 0.5, i % 2 === 0 ? 0.035 : 0.018, 'hat');
    }
    if (index === 0) noise(r, at, 0.1, 'crash');
  } else if (index % 4 === 2) {
    // The hold gets no drums at all — silence is what makes a base feel like
    // somewhere you are safe — but a rising arpeggio every fourth bar keeps
    // the quiet from turning into nothing.
    for (let i = 0; i < 4; i++) {
      pluck(r, pitch(mood, triad[i % 3]! + (i >= 3 ? 7 : 0)), at + beat * (0.5 + i * 0.75), beat * 1.2, 0.05);
    }
  }

  bar++;
}

/**
 * Top up the queue.
 *
 * The timer is deliberately sloppy and the audio clock is not: everything is
 * placed at an absolute time on `ctx.currentTime`, so a late tick changes
 * nothing anyone can hear. This is the difference between a sequencer and a
 * `setTimeout` loop, and it is most of why the old one sounded amateur.
 */
function tick(): void {
  const r = rig;
  if (!r || !running) return;
  const section = SECTIONS[mood];
  const barSeconds = section.beatsPerBar * (60 / section.bpm);

  if (nextBarAt < r.ctx.currentTime) nextBarAt = r.ctx.currentTime + 0.08;
  while (nextBarAt < r.ctx.currentTime + LOOKAHEAD_SECONDS) {
    scheduleBar(r, nextBarAt);
    nextBarAt += barSeconds;
  }
}

/**
 * Start, or change mood.
 *
 * Must be reached from a real gesture the first time: browsers keep an
 * AudioContext suspended until the user has interacted with the page.
 */
export function startMusic(next: MusicMood = 'base'): void {
  if (volume === 0) return;
  const r = ensureRig();
  if (!r) return;
  if (r.ctx.state === 'suspended') void r.ctx.resume();

  if (running && mood === next) return;

  if (mood !== next) {
    /*
     * Cut over on a dip rather than a hard switch.
     *
     * Two keys and two tempos colliding on one frame is the worst sound the
     * game can make, and it happens at exactly the moment a raid opens. A
     * quarter-second duck under the change hides the seam; anything already
     * scheduled rings out into it.
     */
    const now = r.ctx.currentTime;
    r.master.gain.cancelScheduledValues(now);
    r.master.gain.setValueAtTime(r.master.gain.value, now);
    r.master.gain.linearRampToValueAtTime(0.0001, now + 0.22);
    r.master.gain.linearRampToValueAtTime(volume * 0.5, now + 0.75);
    nextBarAt = now + 0.5;
    bar = 0;
  }
  mood = next;

  if (!running) {
    running = true;
    nextBarAt = r.ctx.currentTime + 0.12;
    tick();
    ticker = setInterval(tick, TICK_MS);
  }
}

export function stopMusic(): void {
  running = false;
  if (ticker) clearInterval(ticker);
  ticker = null;
  if (rig) {
    // Fade rather than cut: stopping the timer leaves whatever was already
    // scheduled ringing, and chopping that off is a click.
    const now = rig.ctx.currentTime;
    rig.master.gain.cancelScheduledValues(now);
    rig.master.gain.setValueAtTime(rig.master.gain.value, now);
    rig.master.gain.linearRampToValueAtTime(0.0001, now + 0.3);
  }
}

/** Called on the first tap, alongside the sound-effect unlock. */
export function unlockMusic(): void {
  const r = ensureRig();
  if (r && r.ctx.state === 'suspended') void r.ctx.resume();
}

/** Only for the tests: the written themes, so they can be checked as music. */
export const THEMES = { HOLD, WAR, MODES, TONIC, pitch, loopBeats } as const;
