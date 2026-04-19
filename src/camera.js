import * as THREE from 'three';

const MODES = ['chase', 'cockpit', 'orbit'];
const LABELS = { chase: 'Chase', cockpit: 'Cockpit', orbit: 'Orbit' };
const LOOK_SENS = 0.0022;
const LOOK_RECENTER = 2.5; // rad/s back-to-zero when no input

export class CameraRig {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;
    this.mode = 'chase';
    this._orbitAngle = 0;
    this._offset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._defaultFov = camera.fov;
    this._yaw = 0;     // mouse-driven yaw relative to aircraft
    this._pitch = 0;   // mouse-driven pitch
    this._activeLook = false;
    this._updateHUD();
  }

  bindTarget(group) { this.target = group; }

  cycle() {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    if (this.mode !== 'cockpit') {
      this.camera.fov = this._defaultFov;
      this.camera.updateProjectionMatrix();
    }
    this._yaw = 0;
    this._pitch = 0;
    this._updateHUD();
  }

  _updateHUD() {
    const el = document.getElementById('hud-view');
    if (el) el.textContent = LABELS[this.mode];
  }

  // GTA5-style: mouse moves while pointer locked → rotate look offset
  applyMouseDelta(dx, dy) {
    this._activeLook = true;
    this._yaw -= dx * LOOK_SENS;
    this._pitch -= dy * LOOK_SENS;
    this._pitch = THREE.MathUtils.clamp(this._pitch, -1.1, 1.1);
    const maxYaw = this.mode === 'cockpit' ? Math.PI : Math.PI * 0.95;
    this._yaw = THREE.MathUtils.clamp(this._yaw, -maxYaw, maxYaw);
  }

  // Call each frame when no mouse movement occurred to drift back to center
  _decayLook(dt) {
    if (this._activeLook) { this._activeLook = false; return; }
    const decay = LOOK_RECENTER * dt;
    this._yaw = this._approach(this._yaw, 0, decay);
    this._pitch = this._approach(this._pitch, 0, decay);
  }
  _approach(v, target, step) {
    if (v > target) return Math.max(target, v - step);
    return Math.min(target, v + step);
  }

  update(dt, physics) {
    if (!this.target) return;
    this._decayLook(dt);
    if (this.mode === 'chase') this._chase(dt);
    else if (this.mode === 'cockpit') this._cockpit();
    else if (this.mode === 'orbit') this._orbit(dt);
  }

  _chase(dt) {
    // Desired offset behind/above jet, then rotated by mouse yaw/pitch
    const base = new THREE.Vector3(0, 5, -22);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this._yaw);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this._pitch);
    base.applyQuaternion(yawQ).applyQuaternion(pitchQ);
    this._offset.copy(base).applyQuaternion(this.target.quaternion);
    const desired = this._tmp.copy(this.target.position).add(this._offset);
    const lerp = 1 - Math.pow(0.0008, dt);
    this.camera.position.lerp(desired, Math.min(1, lerp));
    this._lookAt.copy(this.target.position).add(
      new THREE.Vector3(0, 2, 12).applyQuaternion(this.target.quaternion)
    );
    this.camera.lookAt(this._lookAt);
  }

  _cockpit() {
    if (this.camera.fov !== 80) {
      this.camera.fov = 80;
      this.camera.updateProjectionMatrix();
    }
    const seat = new THREE.Vector3(0, 1.1, 4.2).applyQuaternion(this.target.quaternion);
    this.camera.position.copy(this.target.position).add(seat);
    // View direction: forward rotated by mouse yaw/pitch
    const look = new THREE.Vector3(0, 0, 100);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this._yaw);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this._pitch);
    look.applyQuaternion(yawQ).applyQuaternion(pitchQ).applyQuaternion(this.target.quaternion);
    this._lookAt.copy(this.camera.position).add(look);
    this.camera.lookAt(this._lookAt);
  }

  _orbit(dt) {
    this._orbitAngle += dt * 0.25;
    const r = 45;
    this.camera.position.set(
      this.target.position.x + Math.cos(this._orbitAngle + this._yaw) * r,
      this.target.position.y + 15 + this._pitch * 20,
      this.target.position.z + Math.sin(this._orbitAngle + this._yaw) * r,
    );
    this.camera.lookAt(this.target.position);
  }
}
