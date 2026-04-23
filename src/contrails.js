import * as THREE from 'three';

const MAX_POINTS = 400;
const MIN_ALT = 400;    // meters AGL before trails begin
const MIN_SPEED = 180;  // m/s

export class Contrails {
  constructor(scene) {
    this.scene = scene;
    this.trails = [this._make(+1), this._make(-1)];
    this._tmp = new THREE.Vector3();
  }

  _make(side) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false,
    });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    this.scene.add(line);
    return { side, line, positions, colors, count: 0, ages: new Float32Array(MAX_POINTS) };
  }

  update(dt, physics, groundAt) {
    const alt = physics.altitude - groundAt(physics.position.x, physics.position.z);
    const emit = alt > MIN_ALT && physics.speed > MIN_SPEED;
    const right = this._tmp.set(1, 0, 0).applyQuaternion(physics.quaternion);

    for (const t of this.trails) {
      // Age existing points, drop tail when too old
      const maxAge = 6.0;
      let writeIdx = 0;
      for (let i = 0; i < t.count; i++) {
        const newAge = t.ages[i] + dt;
        if (newAge > maxAge) continue;
        t.ages[writeIdx] = newAge;
        t.positions[writeIdx * 3]     = t.positions[i * 3];
        t.positions[writeIdx * 3 + 1] = t.positions[i * 3 + 1];
        t.positions[writeIdx * 3 + 2] = t.positions[i * 3 + 2];
        const a = 1 - newAge / maxAge;
        t.colors[writeIdx * 3]     = a;
        t.colors[writeIdx * 3 + 1] = a;
        t.colors[writeIdx * 3 + 2] = a;
        writeIdx++;
      }
      t.count = writeIdx;

      if (emit && t.count < MAX_POINTS) {
        const pos = physics.position.clone()
          .addScaledVector(right, t.side * 5)
          .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(physics.quaternion), -6);
        t.positions[t.count * 3]     = pos.x;
        t.positions[t.count * 3 + 1] = pos.y;
        t.positions[t.count * 3 + 2] = pos.z;
        t.colors[t.count * 3] = 1;
        t.colors[t.count * 3 + 1] = 1;
        t.colors[t.count * 3 + 2] = 1;
        t.ages[t.count] = 0;
        t.count++;
      }

      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.geometry.attributes.color.needsUpdate = true;
      t.line.geometry.setDrawRange(0, t.count);
      t.line.geometry.computeBoundingSphere();
    }
  }
}
