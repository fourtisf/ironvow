/**
 * Sound, ported from the prototype's synth.
 *
 * Every effect is generated with oscillators at runtime: no audio files, no
 * loading, nothing to add to the download. That matches the art, which is drawn
 * rather than shipped, and it is why the whole game weighs what it does.
 */

let ctx: AudioContext | null = null;
let volume = 1;

const STORAGE_KEY = 'ironvow_sound';
const STORAGE_VOLUME = 'ironvow_sfx_volume';

export function soundEnabled(): boolean {
  return volume > 0;
}

export function sfxVolume(): number {
  return volume;
}

export function setSfxVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
  try {
    localStorage.setItem(STORAGE_VOLUME, String(volume));
  } catch {
    // Private browsing can refuse storage; the setting just will not persist.
  }
}

export function setSoundEnabled(on: boolean): void {
  setSfxVolume(on ? 1 : 0);
}

export function loadSoundPreference(): number {
  try {
    const saved = localStorage.getItem(STORAGE_VOLUME);
    if (saved !== null) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed)) volume = Math.max(0, Math.min(1, parsed));
    } else {
      // Migrate the older on/off setting rather than silently resetting it.
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy !== null) volume = legacy === '1' ? 1 : 0;
    }
  } catch {
    // Fall back to full volume.
  }
  return volume;
}

/**
 * Browsers refuse to start an AudioContext until the user has interacted, so
 * this is called from the first tap rather than on load. Calling it early just
 * leaves the context suspended, which is harmless.
 */
export function unlockAudio(): void {
  const audio = context();
  if (audio && audio.state === 'suspended') void audio.resume();
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

function beep(freq: number, dur = 0.12, type: OscillatorType = 'square', vol = 0.06): void {
  if (volume <= 0) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol * volume), audio.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
}

const later = (ms: number, fn: () => void): void => {
  setTimeout(fn, ms);
};

/**
 * A burst of shaped noise: the part of a cannon, a collapse or a breaking
 * wall that an oscillator cannot make. Built from a short buffer of random
 * samples through a filter, so it is still nothing but arithmetic.
 */
function noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, decay = dur): void {
  if (volume <= 0) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();

  const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = audio.createBufferSource();
  src.buffer = buffer;
  const biquad = audio.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, vol * volume), audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + decay);
  src.connect(biquad);
  biquad.connect(gain);
  gain.connect(audio.destination);
  src.start();
  src.stop(audio.currentTime + dur + 0.02);
}

/** A pitch that falls: the body of a thud, a cannon, a horn's tail. */
function sweep(from: number, to: number, dur: number, type: OscillatorType, vol: number): void {
  if (volume <= 0) return;
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), audio.currentTime + dur);
  gain.gain.setValueAtTime(Math.max(0.0001, vol * volume), audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
}

/** Rate limiting for sounds a battle can fire dozens of times a second. */
const lastAt = new Map<string, number>();
function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  const prev = lastAt.get(key) ?? -Infinity;
  if (now - prev < ms) return false;
  lastAt.set(key, now);
  return true;
}

export const sfx = {
  tap: () => beep(520, 0.07, 'square', 0.04),
  place: () => {
    beep(300, 0.1, 'square', 0.06);
    later(70, () => beep(440, 0.13, 'square', 0.05));
  },
  coin: () => {
    beep(880, 0.06, 'triangle', 0.05);
    later(55, () => beep(1180, 0.09, 'triangle', 0.04));
  },
  up: () => [520, 660, 830].forEach((f, i) => later(i * 80, () => beep(f, 0.12, 'triangle', 0.05))),
  /** Deliberately jittered: a rank of archers firing in unison sounds like one archer. */
  hit: () => beep(150 + Math.random() * 60, 0.05, 'sawtooth', 0.035),
  boom: () => beep(80, 0.28, 'sawtooth', 0.08),
  bad: () => beep(160, 0.22, 'sawtooth', 0.05),
  win: () => [523, 659, 784, 1046].forEach((f, i) => later(i * 110, () => beep(f, 0.18, 'triangle', 0.06))),
  star: (index: number) => beep(660 + index * 220, 0.16, 'triangle', 0.07),

  /* --- the battle ------------------------------------------------------ */

  /** A cannon: a low body and a burst of noise, never more than five a second. */
  cannon: () => {
    if (!throttle('cannon', 180)) return;
    sweep(140, 38, 0.32, 'sawtooth', 0.09);
    noise(0.22, 0.12, 'lowpass', 900, 0.2);
  },
  /** An arrow: a short whistle falling away. */
  arrow: () => {
    if (!throttle('arrow', 60)) return;
    sweep(1800 + Math.random() * 600, 700, 0.09, 'sine', 0.025);
  },
  /** Steel on stone or steel: two bright clicks and a little ring. */
  sword: () => {
    if (!throttle('sword', 90)) return;
    noise(0.04, 0.09, 'highpass', 2600, 0.04);
    beep(1900 + Math.random() * 500, 0.05, 'square', 0.02);
  },
  /** A rampart giving way. */
  wallBreak: () => {
    if (!throttle('wall', 120)) return;
    noise(0.18, 0.11, 'bandpass', 700, 0.16);
    sweep(220, 90, 0.16, 'square', 0.04);
  },
  /** A building coming down: rumble, then the rubble settling. */
  collapse: () => {
    if (!throttle('collapse', 150)) return;
    sweep(110, 30, 0.5, 'sawtooth', 0.1);
    noise(0.45, 0.14, 'lowpass', 500, 0.42);
    later(160, () => noise(0.25, 0.06, 'bandpass', 1200, 0.2));
  },
  /** A troop landing on the field. */
  deploy: () => {
    beep(240, 0.05, 'square', 0.04);
    later(40, () => beep(360, 0.06, 'square', 0.035));
  },
  /** A troop falling. Soft: it happens a lot. */
  fall: () => {
    if (!throttle('fall', 70)) return;
    sweep(320, 140, 0.12, 'triangle', 0.03);
  },
  /** The hero taking the field. */
  hero: () => {
    [330, 440, 660].forEach((f, i) => later(i * 70, () => beep(f, 0.16, 'square', 0.05)));
    later(220, () => noise(0.2, 0.05, 'lowpass', 1200, 0.18));
  },

  /* --- moments --------------------------------------------------------- */

  /** A win: a rising fanfare with a held top note. */
  victory: () => {
    const line = [523, 659, 784, 1046, 784, 1046, 1318];
    line.forEach((f, i) => later(i * 105, () => beep(f, i === line.length - 1 ? 0.6 : 0.16, 'triangle', 0.06)));
    later(105 * (line.length - 1), () => beep(659, 0.6, 'sine', 0.035));
    later(105 * (line.length - 1), () => beep(392, 0.6, 'sine', 0.03));
  },
  /** A loss: three notes, each lower, and a thud. */
  defeat: () => {
    [392, 330, 262].forEach((f, i) => later(i * 160, () => beep(f, 0.24, 'sawtooth', 0.04)));
    later(480, () => sweep(120, 40, 0.4, 'sine', 0.08));
  },
  /** The horn: a war declared, a war won. */
  horn: () => {
    beep(196, 0.5, 'sawtooth', 0.04);
    later(20, () => beep(294, 0.5, 'sawtooth', 0.035));
    later(380, () => beep(262, 0.7, 'sawtooth', 0.045));
    later(400, () => beep(392, 0.7, 'sawtooth', 0.035));
  },
  /** Hammer on wood: a build or upgrade starting. */
  build: () => [0, 130, 260].forEach((ms) => later(ms, () => {
    noise(0.03, 0.08, 'highpass', 1800, 0.03);
    beep(180, 0.06, 'square', 0.03);
  })),
  /** A drum: troops queued. */
  train: () => {
    sweep(180, 70, 0.14, 'sine', 0.08);
    later(150, () => sweep(180, 70, 0.14, 'sine', 0.06));
  },
  /** Something finished while you were here. */
  done: () => [660, 880].forEach((f, i) => later(i * 90, () => beep(f, 0.14, 'triangle', 0.05))),
};
