import * as THREE from 'three';

const COLOR = '#9dffaa';
const COLOR_DIM = 'rgba(157,255,170,0.55)';
const COLOR_WARN = '#ff7040';

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
    this.canvas = document.getElementById('hud-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    // Euler extraction helpers
    this._euler = new THREE.Euler();
  }

  _resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this._dpr = dpr;
  }

  setJetName(name) { if (this.el.jet) this.el.jet.textContent = name; }

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
    this._drawCanvas(physics);
  }

  _drawCanvas(physics) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = W / dpr, h = H / dpr;
    const cx = w / 2, cy = h / 2;

    // Extract pitch (X) and roll (Z) from quaternion in YXZ order
    this._euler.setFromQuaternion(physics.quaternion, 'YXZ');
    const pitch = this._euler.x;     // radians, + = nose up
    const roll = this._euler.z;      // radians, + = right wing down

    ctx.font = '14px "Courier New", monospace';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.shadowColor = 'rgba(0,255,120,0.5)';
    ctx.shadowBlur = 4;

    this._drawArtificialHorizon(ctx, cx, cy, pitch, roll);
    this._drawBankIndicator(ctx, cx, 60, roll);
    this._drawHeadingTape(ctx, cx, h - 36, physics.headingDeg);
    this._drawReticle(ctx, cx, cy);
    this._drawSpeedBracket(ctx, cx - 200, cy, physics.speed * 3.6);
    this._drawAltBracket(ctx, cx + 200, cy, physics.altitude);

    if (physics.stalling) {
      ctx.fillStyle = COLOR_WARN;
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STALL', cx, cy - 170);
    }

    ctx.shadowBlur = 0;
  }

  _drawArtificialHorizon(ctx, cx, cy, pitch, roll) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    // Pitch ladder every 5°, pixel offset per degree
    const PX_PER_DEG = 6;
    const pitchOffset = THREE.MathUtils.radToDeg(pitch) * PX_PER_DEG;
    ctx.translate(0, pitchOffset);

    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1.8;
    // Horizon line
    ctx.beginPath();
    ctx.moveTo(-140, 0);
    ctx.lineTo(-40, 0);
    ctx.moveTo(40, 0);
    ctx.lineTo(140, 0);
    ctx.stroke();

    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    for (let deg = -60; deg <= 60; deg += 5) {
      if (deg === 0) continue;
      const y = -deg * PX_PER_DEG;
      const len = deg % 10 === 0 ? 60 : 30;
      ctx.strokeStyle = deg > 0 ? COLOR : COLOR_DIM;
      ctx.setLineDash(deg > 0 ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(-len, y);
      ctx.lineTo(-len + 20, y + (deg > 0 ? 6 : -6));
      ctx.moveTo(len, y);
      ctx.lineTo(len - 20, y + (deg > 0 ? 6 : -6));
      ctx.stroke();
      if (deg % 10 === 0) {
        ctx.setLineDash([]);
        ctx.fillStyle = deg > 0 ? COLOR : COLOR_DIM;
        ctx.fillText(Math.abs(deg).toString(), -len - 18, y + 4);
        ctx.fillText(Math.abs(deg).toString(), len + 18, y + 4);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Static waterline (boresight)
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy);
    ctx.lineTo(cx - 12, cy);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.moveTo(cx + 6, cy + 6);
    ctx.lineTo(cx + 12, cy);
    ctx.lineTo(cx + 40, cy);
    ctx.stroke();
  }

  _drawBankIndicator(ctx, cx, cy, roll) {
    const r = 110;
    ctx.strokeStyle = COLOR_DIM;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy + 30, r, Math.PI + 0.6, Math.PI * 2 - 0.6);
    ctx.stroke();
    for (const a of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const rad = (a * Math.PI) / 180 - Math.PI / 2;
      const x1 = cx + Math.cos(rad) * r;
      const y1 = cy + 30 + Math.sin(rad) * r;
      const len = a % 30 === 0 ? 10 : 5;
      const x2 = cx + Math.cos(rad) * (r + len);
      const y2 = cy + 30 + Math.sin(rad) * (r + len);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // Pointer (current roll)
    ctx.save();
    ctx.translate(cx, cy + 30);
    ctx.rotate(roll);
    ctx.fillStyle = COLOR;
    ctx.beginPath();
    ctx.moveTo(0, -r + 2);
    ctx.lineTo(-5, -r + 12);
    ctx.lineTo(5, -r + 12);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawHeadingTape(ctx, cx, y, heading) {
    const W = 360;
    ctx.save();
    ctx.translate(cx, y);
    ctx.strokeStyle = COLOR_DIM;
    ctx.strokeRect(-W / 2, -14, W, 28);
    ctx.beginPath();
    ctx.moveTo(0, -18); ctx.lineTo(-6, -25); ctx.lineTo(6, -25); ctx.closePath();
    ctx.fillStyle = COLOR; ctx.fill();

    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'center';
    const PX_PER_DEG = 4;
    for (let d = -60; d <= 60; d += 5) {
      const heading5 = Math.round(heading / 5) * 5;
      const shown = (heading5 + d + 360) % 360;
      const x = d * PX_PER_DEG - ((heading - heading5) * PX_PER_DEG);
      if (Math.abs(x) > W / 2) continue;
      const major = shown % 30 === 0;
      ctx.strokeStyle = COLOR;
      ctx.beginPath();
      ctx.moveTo(x, -14);
      ctx.lineTo(x, major ? 0 : -6);
      ctx.stroke();
      if (major) {
        const label = shown === 0 ? 'N' : shown === 90 ? 'E' : shown === 180 ? 'S' : shown === 270 ? 'W' : shown.toString();
        ctx.fillText(label, x, 10);
      }
    }
    ctx.restore();
  }

  _drawReticle(ctx, cx, cy) {
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLOR;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  _drawSpeedBracket(ctx, x, cy, kmh) {
    ctx.strokeStyle = COLOR;
    ctx.strokeRect(x - 46, cy - 18, 90, 36);
    ctx.fillStyle = COLOR;
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(kmh).toString(), x, cy + 6);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText('KM/H', x, cy - 22);
  }

  _drawAltBracket(ctx, x, cy, alt) {
    ctx.strokeStyle = COLOR;
    ctx.strokeRect(x - 46, cy - 18, 90, 36);
    ctx.fillStyle = COLOR;
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(alt).toString(), x, cy + 6);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText('ALT m', x, cy - 22);
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
