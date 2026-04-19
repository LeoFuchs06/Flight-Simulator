export class HUD {
  constructor() {
    this.el = {
      jet: document.getElementById('hud-jet'),
      speed: document.getElementById('hud-speed'),
      mach: document.getElementById('hud-mach'),
      alt: document.getElementById('hud-alt'),
      hdg: document.getElementById('hud-hdg'),
      throttle: document.getElementById('hud-throttle'),
      throttleFill: document.getElementById('hud-throttle-fill'),
      root: document.getElementById('hud'),
    };
    this._crashOverlay = null;
  }

  setJetName(name) {
    if (this.el.jet) this.el.jet.textContent = name;
  }

  update(physics) {
    const speedKmh = Math.max(0, Math.round(physics.speed * 3.6));
    this.el.speed.textContent = speedKmh;
    this.el.mach.textContent = physics.mach.toFixed(2);
    this.el.alt.textContent = Math.round(physics.altitude);
    this.el.hdg.textContent = String(Math.round(physics.headingDeg) % 360).padStart(3, '0');
    const pct = Math.round(physics.throttle * 100);
    this.el.throttle.textContent = pct + '%';
    this.el.throttleFill.style.width = pct + '%';
    this.el.root.classList.toggle('stall', physics.stalling);
  }

  flashCrash() {
    if (!this._crashOverlay) {
      const d = document.createElement('div');
      d.textContent = 'CRASHED — RESET';
      Object.assign(d.style, {
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Courier New', monospace", fontSize: '64px',
        color: '#ff5040', textShadow: '0 0 12px #ff5040',
        background: 'rgba(60,0,0,0.35)', pointerEvents: 'none',
        zIndex: 20, transition: 'opacity 0.8s', opacity: '1',
      });
      document.body.appendChild(d);
      this._crashOverlay = d;
    }
    const d = this._crashOverlay;
    d.style.opacity = '1';
    clearTimeout(this._crashTimer);
    this._crashTimer = setTimeout(() => { d.style.opacity = '0'; }, 400);
  }
}
