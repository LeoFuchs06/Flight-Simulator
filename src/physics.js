import * as THREE from 'three';
import { airDensity, speedOfSound, RHO0, G_STD } from './atmosphere.js';

const GRAVITY        = G_STD;   // 9.80665 m/s²
const GEAR_CLEARANCE = 2.5;     // m above contact point

// ── Aerodynamic helpers ───────────────────────────────────────────────────────

// Cd0 as a function of Mach (transonic hump, then supersonic drop).
// Peak at M ≈ 1.2 from the subsonic side (2.4× base), then falls.
// There is a small discontinuity at M = 1.2 — acceptable simplification.
function _cd0(base, M) {
  if (M < 0.8) return base;
  if (M < 1.2) return base * (1 + 3.5 * (M - 0.8));
  return base * Math.max(1.0, 1.8 - 0.15 * (M - 1.2));
}

// Mach-dependent thrust factor.
// Turbofan: thrust falls with speed (ram-drag dominates at high M).
// Turbojet: thrust rises up to M ≈ 2.5 (ram compression benefit), then falls.
function _thrustMachFactor(engineType, M) {
  if (engineType === 'turbojet') {
    if (M <= 2.5) return 0.85 + 0.15 * M;
    return Math.max(0.5, 1.225 - 0.5 * (M - 2.5));
  }
  // turbofan (default)
  return Math.max(0.4, 1.0 - 0.25 * M);
}

// ─────────────────────────────────────────────────────────────────────────────

export class Physics {
  constructor(aircraft) {
    this.position   = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity   = new THREE.Vector3();
    this.throttle   = 0;
    this.speed      = 0;
    this.brake      = false;
    this.gearDeployed = true;
    this.afterburner  = false;
    this._groundAt  = null;
    this._forward   = new THREE.Vector3(0, 0, 1);
    this._up        = new THREE.Vector3(0, 1, 0);
    this._tmpQ      = new THREE.Quaternion();
    this._time      = 0;
    this.bindAircraft(aircraft);
  }

  bindAircraft(aircraft) {
    this.aircraft = aircraft;
    this.specs    = aircraft.specs;
    // Start at 50 % fuel; reset when switching jets
    this.fuelMass    = this.specs.maxFuelMass * 0.5;
    this.afterburner = false;
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  get totalMass()  { return this.specs.emptyMass + this.fuelMass; }
  get fuelPct()    { return this.fuelMass / this.specs.maxFuelMass; }
  get altitude()   { return this.position.y; }

  // Altitude-dependent speed of sound for correct Mach display
  get mach() {
    const a = speedOfSound(Math.max(0, this.position.y));
    return Math.max(0, this.speed) / a;
  }

  get headingDeg() {
    const fwd = this._forward;
    return ((Math.atan2(fwd.x, fwd.z) * 180 / Math.PI) + 360) % 360;
  }

  get onGround() {
    const groundH = this._groundAt ? this._groundAt(this.position.x, this.position.z) : 0;
    return this.gearDeployed && this.position.y <= (groundH + GEAR_CLEARANCE + 0.3);
  }

  // Stall speed scales with √(mass/nominalMass) and √(ρ0/ρ) — heavier / higher = faster stall
  get stallSpeedNow() {
    const spec = this.specs;
    const nominalMass = spec.emptyMass + spec.maxFuelMass * 0.5;
    const rho = airDensity(Math.max(0, this.position.y));
    return spec.stallSpeed * Math.sqrt(this.totalMass / nominalMass) * Math.sqrt(RHO0 / rho);
  }

  get stalling() { return !this.onGround && this.speed < this.stallSpeedNow; }

  // ── State snapshots ───────────────────────────────────────────────────────

  reset({ position, headingDeg = 0, speed = 0, throttle = 0 }) {
    this.position.copy(position);
    const rad = THREE.MathUtils.degToRad(headingDeg);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.velocity.copy(this._forward).multiplyScalar(speed);
    this.throttle = throttle;
    this.speed    = speed;
    this._apply();
  }

  snapshot() {
    return {
      position:   this.position.clone(),
      quaternion: this.quaternion.clone(),
      velocity:   this.velocity.clone(),
      throttle:   this.throttle,
      fuelMass:   this.fuelMass,
    };
  }

  restore(s) {
    this.position.copy(s.position);
    this.quaternion.copy(s.quaternion);
    this.velocity.copy(s.velocity);
    this.throttle = s.throttle;
    if (s.fuelMass !== undefined) this.fuelMass = s.fuelMass;
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.speed = this.velocity.dot(this._forward);
    this._apply();
  }

  // ── Main update ───────────────────────────────────────────────────────────

  update(dt, input) {
    const spec = this.specs;

    // ── Throttle ──────────────────────────────────────────────────────────
    if (input.throttleUp)   this.throttle = Math.min(1, this.throttle + dt * 0.5);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dt * 0.5);
    this.brake = !!input.brake;

    // ── Ground detection ──────────────────────────────────────────────────
    const groundH  = this._groundAt ? this._groundAt(this.position.x, this.position.z) : 0;
    const floorY   = groundH + GEAR_CLEARANCE;
    const onGround = this.gearDeployed && this.position.y <= floorY + 0.3;

    // ── Body-frame axes ───────────────────────────────────────────────────
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const fwdSpeed = Math.max(0, this.velocity.dot(this._forward));

    // ── Control authority (0 at standstill → 1 above 0.5 × stallSpeed) ──
    const authority = THREE.MathUtils.clamp(fwdSpeed / (spec.stallSpeed * 0.5), 0, 1.0);

    // ── Steering ──────────────────────────────────────────────────────────
    const tr = spec.turnRate;

    if (onGround) {
      if (input.yaw) {
        const steerAuth = THREE.MathUtils.clamp(fwdSpeed / 15, 0.05, 1.0);
        this._rotateLocal(new THREE.Vector3(0, 1, 0), input.yaw * tr.yaw * 0.5 * dt * steerAuth);
      }
      if (input.pitch) {
        const pitchAuth = THREE.MathUtils.clamp((fwdSpeed / spec.stallSpeed - 0.65) / 0.35, 0, 1);
        this._rotateLocal(new THREE.Vector3(1, 0, 0), input.pitch * tr.pitch * 0.7 * dt * pitchAuth);
      }
    } else {
      if (input.pitch) this._rotateLocal(new THREE.Vector3(1, 0, 0),  input.pitch * tr.pitch * dt * authority);
      if (input.roll)  this._rotateLocal(new THREE.Vector3(0, 0, 1), -input.roll  * tr.roll  * dt * authority);
      if (input.yaw)   this._rotateLocal(new THREE.Vector3(0, 1, 0),  input.yaw   * tr.yaw   * dt * authority);
    }

    // Recompute body axes after rotation
    this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const fwdSpeed2 = Math.max(0, this.velocity.dot(this._forward));

    // ── Atmosphere at current altitude ────────────────────────────────────
    const h      = Math.max(0, this.position.y);
    const rho    = airDensity(h);
    const a_snd  = speedOfSound(h);
    const v      = this.velocity.length();
    const M      = v / a_snd;
    const mass   = this.totalMass;

    // ── Afterburner: activates at full throttle when AB is available ──────
    const hasAB      = spec.wetThrustPerEngine != null;
    this.afterburner = hasAB && this.throttle >= 0.99;

    // ── Thrust ────────────────────────────────────────────────────────────
    // F(h, M) = T_SL × (ρ/ρ0)^0.7 × machFactor × throttle
    const thrustSL    = (this.afterburner ? spec.wetThrustPerEngine : spec.dryThrustPerEngine)
                        * spec.engineCount;
    const altFactor   = Math.pow(rho / RHO0, 0.7);
    const machFactor  = _thrustMachFactor(spec.engineType, M);
    const thrustForce = thrustSL * altFactor * machFactor * this.throttle;

    // ── Fuel burn ─────────────────────────────────────────────────────────
    const tsfc = this.afterburner ? spec.tsfcWet : spec.tsfcDry;
    this.fuelMass = Math.max(0, this.fuelMass - tsfc * thrustForce * dt);

    // ── Aerodynamic drag: D = ½ρv²·S·Cd0(M) ─────────────────────────────
    // Induced drag (Cdi = Cl²/(π·AR·e)) is tiny at high speed; skip for now.
    const cd      = _cd0(spec.cd0, M);
    const dragForce = 0.5 * rho * v * v * spec.wingArea * cd;

    // ── Enforce Mach limit (hard cap) ─────────────────────────────────────
    const maxV = spec.maxMach * a_snd;
    if (v > maxV) this.velocity.multiplyScalar(maxV / v);

    // ── Force → acceleration (F = m·a) ───────────────────────────────────
    const accel = new THREE.Vector3();

    // Thrust along nose
    accel.addScaledVector(this._forward, thrustForce / mass);

    // Drag opposing velocity vector
    if (v > 0.01) {
      accel.addScaledVector(this.velocity, -dragForce / (mass * v));
    }

    // ── Lift & gravity ────────────────────────────────────────────────────
    if (onGround) {
      // Ground carries the aircraft weight; only excess lift causes liftoff.
      // vRatio = fwdSpeed / stallSpeed_ref (sea-level, nominal mass)
      const vRatio     = fwdSpeed2 / spec.stallSpeed;
      const excessLift = GRAVITY * (vRatio * vRatio - 1);
      if (excessLift > 0) accel.y += excessLift;
    } else {
      // Gravity (world-Y down)
      accel.y -= GRAVITY;

      // Lift along aircraft up-axis.
      // Scale by v²/vStall²; vStall is density- and mass-corrected.
      const nominalMass = spec.emptyMass + spec.maxFuelMass * 0.5;
      const vStall      = spec.stallSpeed
                          * Math.sqrt(mass / nominalMass)
                          * Math.sqrt(RHO0 / rho);
      const vRatio      = fwdSpeed2 / vStall;
      const liftScale   = Math.min(vRatio * vRatio, spec.gLimitPos);
      accel.addScaledVector(this._up, GRAVITY * liftScale);
    }

    // ── Integrate velocity ────────────────────────────────────────────────
    this.velocity.addScaledVector(accel, dt);

    // ── Ground friction / brakes ──────────────────────────────────────────
    if (onGround) {
      const horizSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
      if (horizSpeed > 0.01) {
        const decel = this.brake ? 30 : 1.5;
        const scale = Math.max(0, horizSpeed - decel * dt) / horizSpeed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // ── Integrate position ────────────────────────────────────────────────
    this.position.addScaledVector(this.velocity, dt);

    if (onGround && this.position.y < floorY) this.position.y = floorY;

    // Forward speed for HUD
    this.speed = this.velocity.dot(this._forward);

    this._apply();

    // ── Afterburner flame animation ───────────────────────────────────────
    this._time += dt;
    const flames = this.aircraft.group.userData.afterburnerMeshes;
    if (flames && flames.length > 0) {
      const thr = this.throttle;
      const t   = this._time;
      const flicker = 0.88
        + 0.07 * Math.sin(t * 31.7)
        + 0.05 * Math.sin(t * 47.2)
        + 0.04 * Math.sin(t * 73.1);

      // Flames grow larger and brighter with afterburner
      const lenBase = thr * thr;
      const wid     = (0.15 + thr * 0.85) * flicker;

      flames.forEach((mesh, i) => {
        mesh.visible = thr > 0.01;
        const lenVar = lenBase * (0.80 + 0.22 * Math.sin(t * 19.4 + i * 2.1));
        const abLen  = this.afterburner ? lenVar * 1.6 : lenVar;
        mesh.scale.set(wid, Math.max(0.01, abLen), wid);

        // Colour: dark orange → white-yellow; brighter blue-white with AB
        mesh.material.opacity = Math.min(1, (0.05 + thr * 0.88) * flicker);
        if (this.afterburner) {
          // Bright blue-white core when AB is active
          mesh.material.color.setRGB(
            0.85,
            THREE.MathUtils.clamp(0.6 + thr * 0.35, 0, 1),
            THREE.MathUtils.clamp(thr * thr * 0.90, 0, 1),
          );
        } else {
          mesh.material.color.setRGB(
            1.0,
            THREE.MathUtils.clamp(0.15 + thr * 0.72, 0, 1),
            THREE.MathUtils.clamp(thr * thr * 0.40, 0, 1),
          );
        }
      });
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
}
