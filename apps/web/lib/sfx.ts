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
