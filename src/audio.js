// Synthesized jet engine audio using WebAudio.
// Starts on first user interaction (required by browser autoplay policy).

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.throttle = 0;
    this.speed = 0;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    // Rumble: band-passed brown noise
    const bufferSize = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 180;
    noiseFilter.Q.value = 0.9;
    this._rumbleGain = ctx.createGain();
    this._rumbleGain.gain.value = 0;
    noise.connect(noiseFilter).connect(this._rumbleGain);

    // Turbine whine: saw detuned stack
    this._whineGain = ctx.createGain();
    this._whineGain.gain.value = 0;
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = 'lowpass';
    whineFilter.frequency.value = 2400;
    whineFilter.Q.value = 2;
    this._whineOscs = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 400 + i * 4;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(whineFilter);
      o.start();
      this._whineOscs.push(o);
    }
    whineFilter.connect(this._whineGain);

    // Afterburner crackle: filtered white at high throttle
    this._abGain = ctx.createGain();
    this._abGain.gain.value = 0;
    const abSrc = ctx.createBufferSource();
    abSrc.buffer = buf;
    abSrc.loop = true;
    const abFilter = ctx.createBiquadFilter();
    abFilter.type = 'bandpass';
    abFilter.frequency.value = 900;
    abFilter.Q.value = 0.7;
    abSrc.connect(abFilter).connect(this._abGain);

    // Master
    const master = ctx.createGain();
    master.gain.value = 0.35;
    this._rumbleGain.connect(master);
    this._whineGain.connect(master);
    this._abGain.connect(master);
    master.connect(ctx.destination);

    noise.start();
    abSrc.start();
    this._noiseFilter = noiseFilter;
    this._master = master;
  }

  update(dt, throttle, speed) {
    if (!this.ctx || !this._master) return;
    const t = throttle;
    const sp = Math.max(0, speed);
    // Smooth approach
    this.throttle += (t - this.throttle) * Math.min(1, dt * 4);
    this.speed += (sp - this.speed) * Math.min(1, dt * 2);

    const now = this.ctx.currentTime;
    // Rumble grows with speed
    const rumble = 0.15 + Math.min(1, this.speed / 350) * 0.5;
    this._rumbleGain.gain.setTargetAtTime(rumble, now, 0.05);
    this._noiseFilter.frequency.setTargetAtTime(140 + this.speed * 0.6, now, 0.05);

    // Turbine whine pitch follows throttle
    const basePitch = 380 + this.throttle * 620;
    for (let i = 0; i < this._whineOscs.length; i++) {
      this._whineOscs[i].frequency.setTargetAtTime(basePitch + i * 3, now, 0.08);
    }
    this._whineGain.gain.setTargetAtTime(0.12 + this.throttle * 0.28, now, 0.08);

    // Afterburner only above 0.8 throttle
    const ab = Math.max(0, this.throttle - 0.8) * 5; // 0..1
    this._abGain.gain.setTargetAtTime(ab * 0.4, now, 0.05);
  }
}

export class SfxAudio {
  constructor(engine) { this.engine = engine; }
  _ctx() { return this.engine?.ctx; }
  playGun() {
    const ctx = this._ctx(); if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.setValueAtTime(1600, now);
    o.frequency.exponentialRampToValueAtTime(200, now + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    o.connect(g).connect(ctx.destination);
    o.start(now); o.stop(now + 0.08);
  }
  playMissile() {
    const ctx = this._ctx(); if (!ctx) return;
    const now = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0.5;
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(now);
  }
  playExplosion() {
    const ctx = this._ctx(); if (!ctx) return;
    const now = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0.8;
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(now);
  }
}
