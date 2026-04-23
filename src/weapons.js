import * as THREE from 'three';

const GUN_RATE = 1 / 18;      // 18 rps ≈ 1080 rpm (Mauser BK-27 style)
const GUN_SPEED = 1000;        // m/s
const GUN_LIFE = 1.2;          // s
const MISSILE_SPEED_INIT = 60;
const MISSILE_THRUST = 220;
const MISSILE_LIFE = 9;
const MISSILE_COOLDOWN = 0.8;

export class WeaponSystem {
  constructor(scene, groundAt, sfx = null) {
    this.scene = scene;
    this.groundAt = groundAt;
    this.sfx = sfx;
    this._tracers = [];
    this._missiles = [];
    this._explosions = [];
    this._gunTimer = 0;
    this._missileTimer = 0;
    this._tracerMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(3, 2.4, 0.6),
      transparent: true, opacity: 0.95, toneMapped: false,
    });
    this._smokeMat = new THREE.MeshBasicMaterial({
      color: 0xcfcfcf, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this._fireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 1.8, 0.5),
      transparent: true, opacity: 1, depthWrite: false, toneMapped: false,
    });
  }

  update(dt, physics, input) {
    this._gunTimer = Math.max(0, this._gunTimer - dt);
    this._missileTimer = Math.max(0, this._missileTimer - dt);

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(physics.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(physics.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(physics.quaternion);

    if (input.fireGun && this._gunTimer <= 0) {
      this._gunTimer = GUN_RATE;
      this._spawnTracer(physics, fwd, right, up, +1);
      this._spawnTracer(physics, fwd, right, up, -1);
      this.sfx?.playGun();
    }
    if (input.fireMissile && this._missileTimer <= 0) {
      this._missileTimer = MISSILE_COOLDOWN;
      this._spawnMissile(physics, fwd, right, up);
      this.sfx?.playMissile();
    }

    this._updateTracers(dt);
    this._updateMissiles(dt);
    this._updateExplosions(dt);
  }

  _spawnTracer(physics, fwd, right, up, side) {
    const origin = physics.position.clone()
      .addScaledVector(right, side * 1.5)
      .addScaledVector(up, -0.2)
      .addScaledVector(fwd, 3);
    const vel = fwd.clone().multiplyScalar(GUN_SPEED)
      .add(physics.velocity);
    const geom = new THREE.BufferGeometry();
    const pts = new Float32Array([
      origin.x, origin.y, origin.z,
      origin.x, origin.y, origin.z,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(geom, this._tracerMat);
    line.frustumCulled = false;
    this.scene.add(line);
    this._tracers.push({ line, origin, vel, life: GUN_LIFE });
  }

  _updateTracers(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      t.origin.addScaledVector(t.vel, dt);
      // Update endpoints: a short visible streak
      const tail = t.origin.clone().addScaledVector(t.vel, -0.03);
      const arr = t.line.geometry.attributes.position.array;
      arr[0] = tail.x; arr[1] = tail.y; arr[2] = tail.z;
      arr[3] = t.origin.x; arr[4] = t.origin.y; arr[5] = t.origin.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      if (t.life <= 0 || t.origin.y < this.groundAt(t.origin.x, t.origin.z)) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this._tracers.splice(i, 1);
      }
    }
  }

  _spawnMissile(physics, fwd, right, up) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 3, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.6 })
    );
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2c })
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = 1.75;
    g.add(nose);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 1.5, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.5, 2, 0.6),
        transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false,
      })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -2.2;
    g.add(flame);

    // Alternate left/right wingtip
    const side = this._missiles.length % 2 === 0 ? 1 : -1;
    const origin = physics.position.clone()
      .addScaledVector(right, side * 2.2)
      .addScaledVector(up, -0.3);
    g.position.copy(origin);
    g.quaternion.copy(physics.quaternion);
    this.scene.add(g);

    const vel = fwd.clone().multiplyScalar(MISSILE_SPEED_INIT).add(physics.velocity);

    this._missiles.push({
      group: g, flame, vel, life: MISSILE_LIFE, smokeTimer: 0, smokes: [],
    });
  }

  _updateMissiles(dt) {
    for (let i = this._missiles.length - 1; i >= 0; i--) {
      const m = this._missiles[i];
      m.life -= dt;

      // Rocket motor along forward
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(m.group.quaternion);
      m.vel.addScaledVector(fwd, MISSILE_THRUST * dt);
      // Gravity & tiny drag
      m.vel.y -= 9.81 * dt * 0.5;
      m.vel.multiplyScalar(1 - 0.001 * m.vel.length() * dt);
      // Point nose toward velocity
      const dir = m.vel.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      m.group.quaternion.slerp(q, 0.15);
      m.group.position.addScaledVector(m.vel, dt);

      // Flame flicker
      m.flame.scale.setScalar(0.8 + Math.random() * 0.6);

      // Smoke puffs
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.04;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), this._smokeMat.clone());
        puff.position.copy(m.group.position).addScaledVector(fwd, -1.6);
        this.scene.add(puff);
        m.smokes.push({ mesh: puff, life: 2.5 });
      }
      for (let j = m.smokes.length - 1; j >= 0; j--) {
        const s = m.smokes[j];
        s.life -= dt;
        s.mesh.scale.multiplyScalar(1 + dt * 1.5);
        s.mesh.material.opacity = Math.max(0, s.life / 2.5) * 0.8;
        if (s.life <= 0) {
          this.scene.remove(s.mesh);
          s.mesh.geometry.dispose();
          s.mesh.material.dispose();
          m.smokes.splice(j, 1);
        }
      }

      const ground = this.groundAt(m.group.position.x, m.group.position.z);
      if (m.life <= 0 || m.group.position.y < ground + 1) {
        this._detonate(m.group.position.clone(), ground);
        this._removeMissile(i);
      }
    }
  }

  _removeMissile(i) {
    const m = this._missiles[i];
    this.scene.remove(m.group);
    m.group.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose?.(); }
    });
    for (const s of m.smokes) {
      this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
    }
    this._missiles.splice(i, 1);
  }

  _detonate(pos, groundY) {
    pos.y = Math.max(pos.y, groundY + 0.5);
    this.sfx?.playExplosion();
    const fire = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), this._fireMat.clone());
    fire.position.copy(pos);
    this.scene.add(fire);
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), this._smokeMat.clone());
    smoke.material.opacity = 0.95;
    smoke.material.color.setHex(0x444444);
    smoke.position.copy(pos);
    this.scene.add(smoke);
    this._explosions.push({ fire, smoke, life: 0, maxLife: 1.6, pos });
  }

  _updateExplosions(dt) {
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const e = this._explosions[i];
      e.life += dt;
      const t = e.life / e.maxLife;
      e.fire.scale.setScalar(1 + t * 4);
      e.fire.material.opacity = Math.max(0, 1 - t);
      e.smoke.scale.setScalar(1 + t * 8);
      e.smoke.position.y = e.pos.y + t * 15;
      e.smoke.material.opacity = Math.max(0, 0.9 - t * 0.7);
      if (e.life >= e.maxLife) {
        this.scene.remove(e.fire); e.fire.geometry.dispose(); e.fire.material.dispose();
        this.scene.remove(e.smoke); e.smoke.geometry.dispose(); e.smoke.material.dispose();
        this._explosions.splice(i, 1);
      }
    }
  }
}
