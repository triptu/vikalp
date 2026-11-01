/* A soft wooden tap when the visitor swaps a version: a short rounded knock with a
   little paper on top, about 60 ms, peaking near -18 dBFS. Synthesised, so there is
   no file to load.

   window.VikalpSound = { play(), on }
     play() taps once, at most every 60 ms, with a ±3% change in pitch so repeats
     don't sound mechanical. Call it only from the visitor's own click or key press:
     browsers start audio only then.
     on is the visitor's choice, kept in localStorage; it starts on. */
window.VikalpSound = (() => {
  const KEY = 'vk-sound';
  const GAIN = 0.145;
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
  let ctx = null, last = -Infinity, noise = null;

  function envelope(t, attack, decay, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function tap(pitch) {
    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = GAIN;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2600;
    warm.connect(out).connect(ctx.destination);

    const knock = ctx.createOscillator();
    knock.frequency.setValueAtTime(620 * pitch, t);
    knock.frequency.exponentialRampToValueAtTime(410 * pitch, t + 0.03);
    knock.connect(envelope(t, 0.002, 0.075, 0.8)).connect(warm);
    knock.start(t);
    knock.stop(t + 0.1);

    noise ??= (() => {
      const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.02), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const paper = ctx.createBufferSource();
    paper.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2000 * pitch;
    band.Q.value = 0.7;
    paper.connect(band).connect(envelope(t, 0.001, 0.012, 0.35)).connect(warm);
    paper.start(t);
  }

  function play() {
    if (!on) return;
    const now = performance.now();
    if (now - last < 60) return;
    last = now;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      tap(1 + (Math.random() * 2 - 1) * 0.03);
    } catch (e) {}
  }

  return {
    play,
    get on() { return on; },
    set on(value) {
      on = !!value;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
    },
  };
})();
