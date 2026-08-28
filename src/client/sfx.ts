/**
 * Tiny WebAudio-synthesized sound effects for the batch spectacle. No audio assets.
 * The AudioContext is created lazily inside click handlers (a user gesture), so autoplay
 * policy allows it. Everything is wrapped in try/catch — audio is garnish, never load-bearing.
 */

let ctx: AudioContext | null = null;
const ac = () => {
  ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume(); // Safari
  return ctx;
};

const tone = (a: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = 'triangle', peak = 0.25) => {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
};

/** Paper-tear pop per present click; pitch rises with each of the 3 clicks (step 1..3). */
export function playClick(step: number) {
  try {
    const a = ac();
    const t = a.currentTime;
    tone(a, 280 + step * 140, t, 0.09, 'square', 0.18); // pop
    // Short decaying noise burst: the wrapping-paper tear.
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * 0.08), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    const g = a.createGain();
    g.gain.value = 0.12;
    src.buffer = buf;
    src.connect(g).connect(a.destination);
    src.start(t);
  } catch {
    /* audio is garnish */
  }
}

/** Ascending fanfare when the present bursts open. */
export function playFanfare() {
  try {
    const a = ac();
    const t = a.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, f, t + i * 0.12, 0.35));
    tone(a, 1318.5, t + 0.48, 0.6, 'sine', 0.15); // sparkle on top
  } catch {
    /* ditto */
  }
}
