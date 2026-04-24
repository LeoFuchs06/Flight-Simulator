import * as THREE from 'three';

const MODES  = ['chase', 'cockpit', 'orbit'];
const LABELS = { chase: 'Locked', cockpit: 'Cockpit', orbit: 'Orbit' };

// Tail cam offset (aircraft local space)
const CAM_DIST   = 24;   // Meter hinter dem Heck
const CAM_HEIGHT =  6;   // Meter über dem Zentrum

// Cockpit
const COCKPIT_SENS = 0.003;
const AUTO_CENTER  = 1.5;   // Sekunden bis Auto-Zentrierung

// Konvertierung: Flugzeug nutzt +Z=forward, Kamera schaut entlang -Z.
// 180° um Y dreht die Kamera so, dass -Z auf das +Z des Flugzeugs zeigt.
const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class CameraRig {
  constructor(camera, target) {
    this.camera  = camera;
    this.target  = target;
    this.mode    = 'chase';
    this._orbitAngle   = 0;
    this._defaultFov   = camera.fov;
    this._cockpitYaw   = 0;
    this._cockpitPitch = 0;
    this._noInputTimer = 0;
    this._hasInput     = false;
    this._updateHUD();
  }

  bindTarget(group) { this.target = group; }

  cycle() {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    this.camera.fov = this._defaultFov;
    this.camera.updateProjectionMatrix();
    this._updateHUD();
  }

  _updateHUD() {
    const el = document.getElementById('hud-view');
    if (el) el.textContent = LABELS[this.mode];
  }

  applyMouseDelta(dx, dy) {
    if (this.mode !== 'cockpit') return;
    this._hasInput     = true;
    this._cockpitYaw   = THREE.MathUtils.clamp(this._cockpitYaw   - dx * COCKPIT_SENS, -Math.PI, Math.PI);
    this._cockpitPitch = THREE.MathUtils.clamp(this._cockpitPitch - dy * COCKPIT_SENS, -1.2, 1.2);
  }

  update(dt, physics) {
    if (!this.target) return;
    if (this._hasInput) { this._noInputTimer = 0; this._hasInput = false; }
    else                  this._noInputTimer += dt;

    if      (this.mode === 'chase')   this._chase();
    else if (this.mode === 'cockpit') this._cockpit(dt);
    else if (this.mode === 'orbit')   this._orbit(dt);
  }

  // ── STARRE HECK-KAMERA ───────────────────────────────────────────────────────
  // Kein Lerp, kein Damping, kein Spring-Arm.
  // Kamera wird frame-genau als Slave des Flugzeug-Quaternions gesetzt.
  _chase() {
    const q = this.target.quaternion;

    // 1. Position: fester Offset hinter + über dem Flugzeug (Aircraft Local → World)
    this.camera.position
      .set(0, CAM_HEIGHT, -CAM_DIST)
      .applyQuaternion(q)
      .add(this.target.position);

    // 2. Rotation: Flugzeug-Quaternion direkt übernehmen + 180° Y-Flip.
    //    Bewirkt: Kamera-(-Z) zeigt auf Flugzeugnase (+Z).
    //    Roll, Pitch, Yaw werden zu 100% übertragen – kein Abdämpfen.
    this.camera.quaternion.copy(q).multiply(Y_FLIP);
  }

  // ── COCKPIT ──────────────────────────────────────────────────────────────────
  _cockpit(dt) {
    const alpha = (s) => 1 - Math.exp(-s * dt);

    if (Math.abs(this.camera.fov - 80) > 0.1) {
      this.camera.fov = 80;
      this.camera.updateProjectionMatrix();
    }

    if (this._noInputTimer > AUTO_CENTER) {
      const d = alpha(2.5);
      this._cockpitYaw   -= this._cockpitYaw   * d;
      this._cockpitPitch -= this._cockpitPitch * d;
    }

    const seat = new THREE.Vector3(0, 1.1, 4.2).applyQuaternion(this.target.quaternion);
    this.camera.position.copy(this.target.position).add(seat);

    const lookDir = new THREE.Vector3(0, 0, 100)
      .applyQuaternion(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(this._cockpitPitch, this._cockpitYaw, 0, 'YXZ')
        )
      )
      .applyQuaternion(this.target.quaternion);

    this.camera.up.set(0, 1, 0).applyQuaternion(this.target.quaternion);
    this.camera.lookAt(this.camera.position.clone().add(lookDir));
  }

  // ── ORBIT ────────────────────────────────────────────────────────────────────
  _orbit(dt) {
    this._orbitAngle += dt * 0.3;
    const r = 60;
    this.camera.position.set(
      this.target.position.x + Math.cos(this._orbitAngle) * r,
      this.target.position.y + 20,
      this.target.position.z + Math.sin(this._orbitAngle) * r,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target.position);
  }
}
