import * as THREE from 'three';

const MODES = ['chase', 'cockpit', 'orbit'];
const LABELS = { chase: 'Chase', cockpit: 'Cockpit', orbit: 'Orbit' };

export class CameraRig {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;
    this.mode = 'chase';
    this._orbitAngle = 0;
    this._tmp = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._currentPos = new THREE.Vector3();
    this._defaultFov = camera.fov;
    this._updateHUD();
  }

  bindTarget(group) {
    this.target = group;
  }

  cycle() {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    if (this.mode !== 'cockpit') {
      this.camera.fov = this._defaultFov;
      this.camera.updateProjectionMatrix();
    }
    this._updateHUD();
  }

  _updateHUD() {
    const el = document.getElementById('hud-view');
    if (el) el.textContent = LABELS[this.mode];
  }

  update(dt, physics) {
    if (!this.target) return;
    if (this.mode === 'chase') this._chase(dt);
    else if (this.mode === 'cockpit') this._cockpit();
    else if (this.mode === 'orbit') this._orbit(dt);
  }

  _chase(dt) {
    this._offset.set(0, 5, -22).applyQuaternion(this.target.quaternion);
    const desired = this._tmp.copy(this.target.position).add(this._offset);
    const lerp = 1 - Math.pow(0.001, dt);
    this.camera.position.lerp(desired, Math.min(1, lerp * 2.2));
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.target.quaternion);
    this._lookAt.copy(this.target.position).addScaledVector(forward, 20).add(new THREE.Vector3(0, 2, 0));
    this.camera.lookAt(this._lookAt);
  }

  _cockpit() {
    if (this.camera.fov !== 80) {
      this.camera.fov = 80;
      this.camera.updateProjectionMatrix();
    }
    this._offset.set(0, 1.1, 4.2).applyQuaternion(this.target.quaternion);
    this.camera.position.copy(this.target.position).add(this._offset);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.target.quaternion);
    this._lookAt.copy(this.camera.position).addScaledVector(forward, 100);
    this.camera.lookAt(this._lookAt);
  }

  _orbit(dt) {
    this._orbitAngle += dt * 0.35;
    const r = 45;
    this.camera.position.set(
      this.target.position.x + Math.cos(this._orbitAngle) * r,
      this.target.position.y + 15,
      this.target.position.z + Math.sin(this._orbitAngle) * r,
    );
    this.camera.lookAt(this.target.position);
  }
}
