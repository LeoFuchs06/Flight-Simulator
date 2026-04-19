import * as THREE from 'three';

const GRAVITY = 9.81;

export class Physics {
  constructor(aircraft) {
    this.bindAircraft(aircraft);
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.throttle = 0.5;
    this.speed = 0;
    this.brake = false;
    this._tmpV = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this._forward = new THREE.Vector3(0, 0, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  bindAircraft(aircraft) {
    this.aircraft = aircraft;
    this.specs = aircraft.specs;
  }

  reset({ position, headingDeg = 0, speed = 100, throttle = 0.5 }) {
    this.position.copy(position);
    const rad = THREE.MathUtils.degToRad(headingDeg);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.velocity.copy(this._forward).multiplyScalar(speed);
    this.speed = speed;
    this.throttle = throttle;
    this._apply();
  }

  snapshot() {
    return {
      position: this.position.clone(),
      quaternion: this.quaternion.clone(),
      velocity: this.velocity.clone(),
      throttle: this.throttle,
    };
  }

  restore(s) {
    this.position.copy(s.position);
    this.quaternion.copy(s.quaternion);
    this.velocity.copy(s.velocity);
    this.throttle = s.throttle;
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.speed = this.velocity.dot(this._forward);
    this._apply();
  }

  update(dt, input) {
    const spec = this.specs;

    // Throttle control
    if (input.throttleUp) this.throttle = Math.min(1, this.throttle + dt * 0.4);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dt * 0.4);
    this.brake = !!input.brake;

    // Rotation: apply local pitch/yaw/roll
    const tr = spec.turnRate;
    // Reduce control authority at very low airspeed (below stall)
    const speedForControl = Math.max(0, this.speed);
    const authority = THREE.MathUtils.clamp(speedForControl / 80, 0.25, 1.0);
    if (input.pitch) this._rotateLocal(new THREE.Vector3(1, 0, 0), input.pitch * tr.pitch * dt * authority);
    if (input.roll) this._rotateLocal(new THREE.Vector3(0, 0, 1), -input.roll * tr.roll * dt * authority);
    if (input.yaw) this._rotateLocal(new THREE.Vector3(0, 1, 0), input.yaw * tr.yaw * dt * authority);

    // Update body frame vectors
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);

    // Compute forces (acceleration units)
    const accel = this._tmpV.set(0, 0, 0);

    // Thrust along forward
    const thrust = this.throttle * spec.maxThrust;
    accel.addScaledVector(this._forward, thrust);

    // Drag opposite velocity
    const v = this.velocity.length();
    if (v > 0.001) {
      const dragMag = spec.drag * v * v + (this.brake ? 0.5 * v : 0);
      accel.addScaledVector(this.velocity, -dragMag / v);
    }

    // Lift perpendicular to velocity in the direction of aircraft "up"
    // Lift magnitude ~ liftFactor * v² * 0.001
    const liftMag = spec.liftFactor * v * v * 0.001;
    accel.addScaledVector(this._up, liftMag);

    // Gravity
    accel.y -= GRAVITY;

    // Integrate
    this.velocity.addScaledVector(accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // Forward-projected speed (for HUD)
    this.speed = this.velocity.dot(this._forward);

    this._apply();

    // Afterburner emissive pulse
    const ab = this.aircraft.group.userData.afterburnerMaterials;
    if (ab) {
      const intensity = 0.3 + this.throttle * 1.2;
      for (const mat of ab) {
        mat.opacity = 0.35 + this.throttle * 0.55;
        if (mat.color) {
          // shift hue from dull orange (low throttle) to bright white-yellow (high)
          const hi = this.throttle;
          mat.color.setRGB(1, 0.4 + hi * 0.5, 0.1 + hi * 0.5);
        }
      }
    }
  }

  _rotateLocal(axis, angle) {
    this._tmpQ.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(this._tmpQ);
    this.quaternion.normalize();
  }

  _apply() {
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
  }

  get altitude() { return this.position.y; }
  get mach() { return Math.max(0, this.speed) / 340; }
  get headingDeg() {
    const fwd = this._forward;
    const deg = (Math.atan2(fwd.x, fwd.z) * 180) / Math.PI;
    return (deg + 360) % 360;
  }
  get stalling() { return this.speed < this.specs.stallSpeed; }
}
