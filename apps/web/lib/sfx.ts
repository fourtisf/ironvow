/**
 * Sound, ported from the prototype's synth.
 *
 * Every effect is generated with oscillators at runtime: no audio files, no
 * loading, nothing to add to the download. That matches the art, which is drawn
 * rather than shipped, and it is why the whole game weighs what it does.
 */

let ctx: AudioContext | null = null;
let enabled = true;

const STORAGE_KEY = 'ironvow_sound';

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private browsing can refuse storage; the setting just will not persist.
  }
}

export function loadSoundPreference(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) enabled = saved === '1';
  } catch {
    // Same as above: fall back to on.
  }
  return enabled;
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
  if (!enabled) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(vol, audio.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
}

const later = (ms: number, fn: () => void): void => {
  setTimeout(fn, ms);
};

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
};
