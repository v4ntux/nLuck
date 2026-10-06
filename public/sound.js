// Звуки синтезируются Web Audio — без файлов, грузятся мгновенно.
let ctx = null, noise = null, master = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Браузеры разрешают звук только после касания
['pointerdown', 'touchstart', 'keydown'].forEach(e => addEventListener(e, () => ac(), { once: true, passive: true }));

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

// шелест / шлепок бумаги
function rustle({ freq = 2500, q = 0.8, dur = 0.08, gain = 0.5, type = 'bandpass', at = 0, sweep = 0 } = {}) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource(); src.buffer = noise;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
  const g = c.createGain(); env(g, t, 0.004, gain, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.05);
}

function tone(freq, { dur = 0.2, type = 'sine', gain = 0.25, at = 0, slide = 0 } = {}) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = c.createGain(); env(g, t, 0.008, gain, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  click: () => rustle({ freq: 3800, dur: 0.025, gain: 0.25, q: 2 }),
  flick: (at = 0) => rustle({ freq: 3200, dur: 0.11, gain: 0.45, q: 0.7, sweep: 0.5, at }),
  land: (at = 0) => {
    rustle({ freq: 900, type: 'lowpass', dur: 0.09, gain: 0.9, q: 0.5, at });
    tone(140, { dur: 0.08, gain: 0.25, slide: 0.6, at });
  },
  deal: (at = 0) => rustle({ freq: 4200, dur: 0.07, gain: 0.3, q: 1, sweep: 0.6, at }),
  draw: (at = 0) => rustle({ freq: 1800, dur: 0.16, gain: 0.35, q: 0.6, sweep: 2, at }),
  shuffle: () => { for (let i = 0; i < 12; i++) rustle({ freq: 3000 + Math.random() * 1500, dur: 0.035, gain: 0.3, q: 1.5, at: i * 0.045 }); },
  turn: () => { tone(880, { dur: 0.25, gain: 0.12 }); tone(1320, { dur: 0.35, gain: 0.1, at: 0.09 }); },
  penalty: () => { tone(220, { dur: 0.16, type: 'triangle', gain: 0.25 }); tone(165, { dur: 0.25, type: 'triangle', gain: 0.25, at: 0.13 }); },
  skip: () => tone(600, { dur: 0.18, type: 'triangle', gain: 0.18, slide: 1.6 }),
  error: () => tone(130, { dur: 0.14, type: 'square', gain: 0.08 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.3, type: 'triangle', gain: 0.18, at: i * 0.11 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, { dur: 0.35, type: 'triangle', gain: 0.18, at: i * 0.15 })),
  lastCard: () => { tone(988, { dur: 0.12, type: 'square', gain: 0.07 }); tone(988, { dur: 0.12, type: 'square', gain: 0.07, at: 0.16 }); tone(1319, { dur: 0.3, type: 'triangle', gain: 0.15, at: 0.32 }); },
  pop: () => { tone(500, { dur: 0.1, gain: 0.15, slide: 2 }); rustle({ freq: 2000, dur: 0.03, gain: 0.15 }); },
  stamp: () => { rustle({ freq: 500, type: 'lowpass', dur: 0.12, gain: 1 }); tone(90, { dur: 0.12, gain: 0.3, slide: 0.5 }); },
};

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('muted', v ? '1' : '0'); } catch {}
}
