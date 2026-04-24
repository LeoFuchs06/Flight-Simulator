import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scale GLB models to be roughly the same visual size
const GLB_SCALE = { eurofighter: 1.0, mig31: 0.9, mig25: 0.85, a10: 0.6, f22: 0.95, f35: 0.8 };
const GLB_ROTATION = {
  eurofighter: { x: 0, y: -Math.PI / 2, z: 0 },
  mig31: { x: 0, y: 0, z: 0 },
  mig25: { x: 0, y: Math.PI, z: 0 },
  a10: { x: 0, y: 0, z: 0 },
  f22: { x: 0, y: Math.PI, z: 0 }, // Rotate 180° around Y-axis
  f35: { x: 0, y: 0, z: 0 }
};
const _glbCache = new Map();
const _loader = new GLTFLoader();

async function tryLoadGLB(type) {
  if (_glbCache.has(type)) return _glbCache.get(type);
  const url = `assets/${type}.glb`;
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (!head || !head.ok) { _glbCache.set(type, null); return null; }
  return new Promise((resolve) => {
    _loader.load(url, (gltf) => {
      _glbCache.set(type, gltf.scene);
      resolve(gltf.scene);
    }, undefined, () => { _glbCache.set(type, null); resolve(null); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Aircraft physical parameters — all SI units
//
// engineType:           'turbofan' | 'turbojet'
//   turbofan Mach correction: T_f = max(0.4, 1 - 0.25·M)   (thrust falls with speed)
//   turbojet Mach correction: T_f = 0.85 + 0.15·M          (thrust rises to M≈2.5)
//
// Altitude correction (both types): T(h) = T_SL · (ρ(h)/ρ0)^0.7
//
// Afterburner activates automatically at throttle ≥ 99 %.
//   Aircraft without AB: wetThrustPerEngine = null.
//
// tsfcDry / tsfcWet: Thrust Specific Fuel Consumption [kg/(N·s)]
//   Fuel burn rate = TSFC × actual_thrust
//
// cd0:      zero-lift drag coefficient (subsonic, clean configuration)
//   Transonic correction:
//     0.8 ≤ M < 1.2 → cd0 · (1 + 3.5·(M − 0.8))
//     M ≥ 1.2       → cd0 · max(1, 1.8 − 0.15·(M − 1.2))
//
// stallSpeed: reference sea-level stall speed [m/s] at nominal mass (50 % fuel).
//   Used for control-authority scaling; actual stall speed scales with √(m/m_nom)
//   and √(ρ0/ρ) for altitude.
// ─────────────────────────────────────────────────────────────────────────────
export const AIRCRAFT_SPECS = {
  eurofighter: {
    displayName: 'Eurofighter Typhoon',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbofan',   // EJ200
    engineCount:          2,
    dryThrustPerEngine:   60000,        // N  (military power, sea level)
    wetThrustPerEngine:   90000,        // N  (full afterburner, sea level)
    tsfcDry:              1.5e-5,       // kg/(N·s)
    tsfcWet:              4.0e-5,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            11000,        // kg
    maxFuelMass:          4500,         // kg (internal)
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             50.0,         // m²
    aspectRatio:          2.2,
    cd0:                  0.018,        // subsonic clean
    clMax:                1.6,
    gLimitPos:            9.0,
    maxMach:              2.0,
    // ── Control (unchanged) ─────────────────────────────────────────────────
    stallSpeed:           55,           // m/s  (ref., 50 % fuel, sea level)
    turnRate: { pitch: 1.8, roll: 3.2, yaw: 0.9 },
  },

  mig31: {
    displayName: 'MiG-31 Foxhound',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbojet',   // D-30F6 (low-bypass, turbojet behaviour)
    engineCount:          2,
    dryThrustPerEngine:   93000,        // N
    wetThrustPerEngine:   152000,       // N
    tsfcDry:              2.5e-5,
    tsfcWet:              6.0e-5,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            21820,        // kg
    maxFuelMass:          16350,        // kg
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             61.6,         // m²
    aspectRatio:          2.94,
    cd0:                  0.024,
    clMax:                1.3,
    gLimitPos:            5.0,
    maxMach:              2.83,
    // ── Control ─────────────────────────────────────────────────────────────
    stallSpeed:           75,
    turnRate: { pitch: 1.2, roll: 1.9, yaw: 0.7 },
  },

  mig25: {
    displayName: 'MiG-25 Foxbat',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbojet',   // R-15B-300 (pure turbojet)
    engineCount:          2,
    dryThrustPerEngine:   73500,        // N
    wetThrustPerEngine:   100100,       // N
    tsfcDry:              2.5e-5,
    tsfcWet:              6.5e-5,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            20000,        // kg
    maxFuelMass:          14570,        // kg
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             61.4,         // m²
    aspectRatio:          3.0,
    cd0:                  0.022,
    clMax:                1.2,
    gLimitPos:            5.0,
    maxMach:              2.83,         // hard cap; real 3.2 destroys engines
    // ── Control ─────────────────────────────────────────────────────────────
    stallSpeed:           70,
    turnRate: { pitch: 1.3, roll: 2.1, yaw: 0.75 },
  },

  a10: {
    displayName: 'A-10 Thunderbolt II',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbofan',   // TF34-GE-100 — no afterburner
    engineCount:          2,
    dryThrustPerEngine:   40300,        // N
    wetThrustPerEngine:   null,         // no afterburner
    tsfcDry:              1.0e-5,
    tsfcWet:              null,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            11321,        // kg
    maxFuelMass:          4990,         // kg
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             47.0,         // m²
    aspectRatio:          6.5,          // high aspect ratio → efficient at low speed
    cd0:                  0.032,        // blunt airframe
    clMax:                1.9,
    gLimitPos:            7.33,
    maxMach:              0.56,         // structural limit
    // ── Control ─────────────────────────────────────────────────────────────
    stallSpeed:           40,
    turnRate: { pitch: 0.9, roll: 1.4, yaw: 0.6 },
  },

  f22: {
    displayName: 'F-22 Raptor',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbofan',   // F119-PW-100
    engineCount:          2,
    dryThrustPerEngine:   116000,       // N  (supercruise at ~M 1.82 dry)
    wetThrustPerEngine:   156000,       // N
    tsfcDry:              1.5e-5,
    tsfcWet:              4.5e-5,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            19700,        // kg
    maxFuelMass:          8200,         // kg
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             78.0,         // m²
    aspectRatio:          2.36,
    cd0:                  0.016,        // lowest of the six (stealth shaping)
    clMax:                1.8,
    gLimitPos:            9.0,
    maxMach:              2.25,
    // ── Control ─────────────────────────────────────────────────────────────
    stallSpeed:           50,
    turnRate: { pitch: 2.0, roll: 3.5, yaw: 1.0 },
  },

  f35: {
    displayName: 'F-35 Lightning II',
    // ── Engine ──────────────────────────────────────────────────────────────
    engineType:           'turbofan',   // F135-PW-600
    engineCount:          1,            // single engine
    dryThrustPerEngine:   125000,       // N
    wetThrustPerEngine:   191000,       // N
    tsfcDry:              1.5e-5,
    tsfcWet:              4.5e-5,
    // ── Mass ────────────────────────────────────────────────────────────────
    emptyMass:            14650,        // kg
    maxFuelMass:          6125,         // kg
    // ── Aerodynamics ────────────────────────────────────────────────────────
    wingArea:             42.7,         // m²
    aspectRatio:          2.66,
    cd0:                  0.020,
    clMax:                1.6,
    gLimitPos:            7.0,
    maxMach:              1.6,
    // ── Control ─────────────────────────────────────────────────────────────
    stallSpeed:           60,
    turnRate: { pitch: 1.7, roll: 3.0, yaw: 0.85 },
  },
};

export function createAircraft(type) {
  const specs = AIRCRAFT_SPECS[type];
  if (!specs) throw new Error('Unknown aircraft type: ' + type);
  let group, afterburners;
  if (type === 'eurofighter') ({ group, afterburners } = buildEurofighter());
  else if (type === 'mig31') ({ group, afterburners } = buildMig31());
  else if (type === 'mig25') ({ group, afterburners } = buildMig25());
  else ({ group, afterburners } = buildEurofighter()); // Use Eurofighter as fallback for new jets

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  attachFlames(group, type); // Flammen für prozedurales Modell

  // Try to swap in a real .glb model if present under assets/<type>.glb
  tryLoadGLB(type).then((scene) => {
    if (!scene) return;
    // Save procedural landing gear before clearing
    const procGear = group.children.find(c => c.userData?.isLandingGear);
    // Remove all procedural parts (incl. old flames – attachFlames cleans up)
    for (let i = group.children.length - 1; i >= 0; i--) {
      group.remove(group.children[i]);
    }
    const inst = scene.clone(true);
    inst.scale.setScalar(GLB_SCALE[type] ?? 1);
    const rot = GLB_ROTATION[type];
    if (rot) {
      inst.rotation.set(rot.x, rot.y, rot.z);
    }
    inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    group.add(inst);

    // Tag gear nodes by known GLB mesh names (inspected per model).
    // LandingOn/Off = Eurofighter two-state gear meshes.
    const gearRe = /gear|wheel|tire|tyre|strut/i;
    let foundGlbGear = false;
    inst.traverse((node) => {
      const n = node.name;
      // LandingOn/LandingOff are landing LIGHTS (not gear) – skip them
      if (/LandingOn|LandingOff|LandingLight/i.test(n)) return;
      if (gearRe.test(n)) {
        node.userData.isLandingGear = true;
        node.visible = true;
        foundGlbGear = true;
      }
    });

    // F-35 / MiG-31 have no named gear → fall back to procedural gear
    if (!foundGlbGear && procGear) {
      procGear.visible = true; // start deployed
      group.add(procGear);
    }

    // Flammen neu erzeugen und am Group befestigen (typ-spezifische Positionen)
    attachFlames(group, type);
  });

  return {
    group,
    specs,
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material?.dispose();
        }
      });
    },
  };
}

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────
function makeCanopy(radiusX, radiusY, radiusZ, color = 0x1a3550) {
  const geo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(radiusX, radiusY, radiusZ);
  const mat = new THREE.MeshStandardMaterial({
    color, metalness: 0.8, roughness: 0.15, transparent: true, opacity: 0.6,
  });
  return new THREE.Mesh(geo, mat);
}

function makeExhaust(radius, length, nozzleColor = 0x1a1a1a) {
  const g = new THREE.Group();
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.05, radius * 0.85, length, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: nozzleColor, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide })
  );
  nozzle.rotation.x = Math.PI / 2;
  g.add(nozzle);
  return g; // flame is handled separately via attachFlames
}

// ── Nachbrenner-Flammen ───────────────────────────────────────────────────────
// Pro Flugzeugtyp: Flammenradius, -länge und Positionen in Group-Local-Space.
// +Z = Nase, -Z = Heck. Werte passen zu prozeduralem Modell + GLB-Näherung.
const EXHAUST_CONFIG = {
  eurofighter: { r: 0.45, len: 2.5, pos: [[-0.55, -0.05, -7.8], [ 0.55, -0.05, -7.8]] },
  mig31:       { r: 0.55, len: 3.2, pos: [[-0.90, -0.10, -9.3], [ 0.90, -0.10, -9.3]] },
  mig25:       { r: 0.50, len: 2.8, pos: [[-0.65, -0.10, -8.4], [ 0.65, -0.10, -8.4]] },
  a10:         { r: 0.38, len: 2.0, pos: [[-2.60,  1.40, -4.8], [ 2.60,  1.40, -4.8]] },
  f22:         { r: 0.55, len: 3.0, pos: [[-0.85,  0.00, -9.5], [ 0.85,  0.00, -9.5]] },
  f35:         { r: 0.68, len: 3.2, pos: [[ 0.00, -0.20, -6.3]]                       },
};

function makeFlame(radius, length) {
  // Basis bei origin, Spitze bei -Z (Heckrichtung).
  // geo.translate(0, length/2, 0): Kegelbasis bei y=0, Spitze bei y=length.
  // rotation.x = -PI/2: y-Achse → -Z, also Spitze zeigt nach hinten.
  const geo = new THREE.ConeGeometry(radius, length, 10);
  geo.translate(0, length / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff5010, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function attachFlames(group, type) {
  // Alte Flammen entfernen (z.B. nach GLB-Load)
  const prev = group.userData.afterburnerMeshes;
  if (prev) for (const f of prev) group.remove(f);

  const cfg = EXHAUST_CONFIG[type];
  if (!cfg) { group.userData.afterburnerMeshes = []; return; }

  const meshes = cfg.pos.map(([x, y, z]) => {
    const m = makeFlame(cfg.r, cfg.len);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  });
  group.userData.afterburnerMeshes = meshes;
}

function makeLandingGear() {
  const g = new THREE.Group();
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.4, roughness: 0.8 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });

  // Left main wheel
  const wheelLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), wheelMat);
  wheelLeft.rotation.z = Math.PI / 2;
  wheelLeft.position.set(-1.5, -2, 0);
  const strutLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2, 0.08), strutMat);
  strutLeft.position.set(-1.5, -1, 0);
  g.add(wheelLeft, strutLeft);

  // Right main wheel
  const wheelRight = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), wheelMat);
  wheelRight.rotation.z = Math.PI / 2;
  wheelRight.position.set(1.5, -2, 0);
  const strutRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2, 0.08), strutMat);
  strutRight.position.set(1.5, -1, 0);
  g.add(wheelRight, strutRight);

  // Nose wheel
  const wheelNose = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16), wheelMat);
  wheelNose.rotation.z = Math.PI / 2;
  wheelNose.position.set(0, -1.8, -3);
  const strutNose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), strutMat);
  strutNose.position.set(0, -0.9, -3);
  g.add(wheelNose, strutNose);

  g.userData.isLandingGear = true;
  g.visible = false; // Hidden by default
  return g;
}

function makeMissile(length = 3.2, radius = 0.15) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.6 })
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length * 0.18, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5 })
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = length * 0.5 + length * 0.09;
  g.add(nose);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xc8c8ca });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, radius * 3.2, length * 0.25), finMat);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(a) * radius, Math.sin(a) * radius, -length * 0.35);
    fin.rotation.z = a;
    g.add(fin);
  }
  return g;
}

function makeStar(size = 0.6) {
  const shape = new THREE.Shape();
  const outer = size, inner = size * 0.4;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcc1a1a, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// ─────────────────────────────────────────────
// EUROFIGHTER TYPHOON
// ─────────────────────────────────────────────
function buildEurofighter() {
  const g = new THREE.Group();
  const bodyColor = 0x7a8690;
  const darkGray = 0x3a4048;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: darkGray, metalness: 0.7, roughness: 0.4 });

  // Fuselage: tapered lathe for smooth profile, length ~16 m
  const fusePts = [];
  const segs = [
    [0, 0.0], [0.5, 0.35], [1.2, 0.55], [2.5, 0.75], [4.5, 0.85], [7.5, 0.82],
    [10.5, 0.75], [13.0, 0.65], [14.5, 0.55], [15.5, 0.45], [16.0, 0.30],
  ];
  for (const [z, r] of segs) fusePts.push(new THREE.Vector2(r, z - 8));
  const fuseGeo = new THREE.LatheGeometry(fusePts, 18);
  fuseGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuseGeo, bodyMat);
  g.add(fuselage);

  // Radome nose tip
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 14), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 8.6;
  g.add(nose);

  // Pitot tube
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), darkMat);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.z = 9.3;
  g.add(pitot);

  // Canopy (bubble)
  const canopy = makeCanopy(0.55, 0.45, 1.6, 0x0b1828);
  canopy.position.set(0, 0.85, 5.0);
  g.add(canopy);

  // Canards (forward mini-wings) — signature Eurofighter feature
  const canardMat = bodyMat;
  const canardGeo = new THREE.BufferGeometry();
  canardGeo.setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.5, 0, -0.7),
    new THREE.Vector3(1.5, 0, -1.3),
    new THREE.Vector3(0.1, 0, -1.0),
  ]);
  canardGeo.setIndex([0, 1, 2, 0, 2, 3]);
  canardGeo.computeVertexNormals();
  for (const side of [1, -1]) {
    const canard = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.08, 1.0),
      canardMat
    );
    canard.position.set(side * 1.2, 0.3, 4.2);
    canard.rotation.y = side * -0.35;
    g.add(canard);
  }

  // Delta wings (cropped delta, ~53° sweep)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 2.5);        // root leading
  wingShape.lineTo(4.8, -2.0);     // tip leading
  wingShape.lineTo(5.1, -2.4);     // tip trailing
  wingShape.lineTo(0.2, -3.2);     // root trailing
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.15, bevelEnabled: false });
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, bodyMat);
    wing.rotation.x = Math.PI / 2;
    wing.position.set(side * 0.7, -0.1, 0);
    wing.scale.x = side;
    g.add(wing);
    // Missile pylons
    for (let i = 0; i < 2; i++) {
      const m = makeMissile(3.0, 0.12);
      m.position.set(side * (2.2 + i * 1.4), -0.3, -0.4);
      g.add(m);
    }
  }

  // Vertical stabilizer (single)
  const vStab = new THREE.Shape();
  vStab.moveTo(0, 0);
  vStab.lineTo(2.2, 3.4);
  vStab.lineTo(3.2, 3.4);
  vStab.lineTo(3.6, 0);
  vStab.closePath();
  const vStabGeo = new THREE.ExtrudeGeometry(vStab, { depth: 0.1, bevelEnabled: false });
  const vStabMesh = new THREE.Mesh(vStabGeo, bodyMat);
  vStabMesh.rotation.y = Math.PI / 2;
  vStabMesh.position.set(0, 0.5, -5.5);
  g.add(vStabMesh);

  // Twin exhausts
  for (const side of [-1, 1]) {
    const exGroup = makeExhaust(0.5, 1.5);
    exGroup.position.set(side * 0.55, -0.05, -7.8);
    g.add(exGroup);
  }

  // Intake lips under canards
  for (const side of [1, -1]) {
    const intake = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.55, 1.2),
      darkMat
    );
    intake.position.set(side * 0.85, -0.3, 3.2);
    g.add(intake);
  }

  // Landing gear
  g.add(makeLandingGear());

  return { group: g, afterburners: [] };
}

// ─────────────────────────────────────────────
// MiG-31 FOXHOUND
// ─────────────────────────────────────────────
function buildMig31() {
  const g = new THREE.Group();
  const bodyColor = 0x8590a0;
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.7, roughness: 0.4 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.5, roughness: 0.55 });

  const SCALE = 1.4;

  // Boxy long fuselage ~22.7 m
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.9, 18) , bodyMat);
  fuselage.position.set(0, 0, 0);
  g.add(fuselage);

  // Tapered front fuselage
  const frontGeo = new THREE.CylinderGeometry(0.9, 0.5, 5, 16);
  frontGeo.rotateX(Math.PI / 2);
  const front = new THREE.Mesh(frontGeo, bodyMat);
  front.position.z = 11.5;
  g.add(front);

  // Nose radome
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 14), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 14.9;
  g.add(nose);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2), darkMat);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.z = 16.2;
  g.add(pitot);

  // Tandem cockpit (pilot + WSO)
  const canopy1 = makeCanopy(0.55, 0.5, 1.4, 0x0a1828);
  canopy1.position.set(0, 1.0, 9.5);
  g.add(canopy1);
  const canopy2 = makeCanopy(0.55, 0.5, 1.3, 0x0a1828);
  canopy2.position.set(0, 1.0, 7.6);
  g.add(canopy2);

  // Large rectangular side air intakes (signature MiG-31)
  for (const side of [1, -1]) {
    const intakeHousing = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.7, 8),
      bodyMat
    );
    intakeHousing.position.set(side * 1.4, -0.1, 3.5);
    g.add(intakeHousing);
    // Intake mouth
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.4), darkMat);
    mouth.position.set(side * 1.4, -0.1, 7.3);
    g.add(mouth);
  }

  // Wings: trapezoidal, moderate sweep
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 3.5);
  wingShape.lineTo(6.8, 0.5);
  wingShape.lineTo(6.8, -1.0);
  wingShape.lineTo(0.3, -3.5);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: false });
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, bodyMat);
    wing.rotation.x = Math.PI / 2;
    wing.position.set(side * 2.0, -0.3, -1.0);
    wing.scale.x = side;
    g.add(wing);

    // Red star on wing top
    const star = makeStar(0.8);
    star.rotation.x = -Math.PI / 2;
    star.position.set(side * 4.5, 0.0, -1.5);
    g.add(star);

    // Two R-33 missiles under each wing
    for (let i = 0; i < 2; i++) {
      const m = makeMissile(4.2, 0.18);
      m.position.set(side * (3.0 + i * 1.6), -0.8, -1.0);
      g.add(m);
    }
  }

  // Twin vertical stabilizers, canted outward
  const vStabShape = new THREE.Shape();
  vStabShape.moveTo(0, 0);
  vStabShape.lineTo(2.0, 3.8);
  vStabShape.lineTo(3.5, 3.8);
  vStabShape.lineTo(4.2, 0);
  vStabShape.closePath();
  const vStabGeo = new THREE.ExtrudeGeometry(vStabShape, { depth: 0.12, bevelEnabled: false });
  for (const side of [1, -1]) {
    const vs = new THREE.Mesh(vStabGeo, bodyMat);
    vs.rotation.y = Math.PI / 2;
    vs.position.set(side * 1.6, 0.8, -6.5);
    vs.rotation.z = side * 0.12;
    g.add(vs);
    // Star on tail
    const s = makeStar(0.7);
    s.position.set(side * 1.8, 2.5, -5.2);
    s.rotation.y = side * Math.PI / 2;
    g.add(s);
  }

  // Horizontal stabilizers
  const hStabGeo = new THREE.BoxGeometry(7, 0.15, 2.5);
  const hStab = new THREE.Mesh(hStabGeo, bodyMat);
  hStab.position.set(0, 0.2, -7.2);
  g.add(hStab);

  // Twin large rectangular exhausts
  for (const side of [-1, 1]) {
    const exhaustHousing = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.3, 1.2),
      darkMat
    );
    exhaustHousing.position.set(side * 0.9, -0.1, -9.3);
    g.add(exhaustHousing);
  }

  // Landing gear
  g.add(makeLandingGear());

  g.scale.setScalar(SCALE);
  return { group: g, afterburners: [] };
}

// ─────────────────────────────────────────────
// MiG-25 FOXBAT
// ─────────────────────────────────────────────
function buildMig25() {
  const g = new THREE.Group();
  const bodyColor = 0xb0b5bc;
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.7, roughness: 0.4 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.75, roughness: 0.35 });

  const SCALE = 1.25;

  // Fuselage: long, slightly more streamlined than MiG-31
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.6, 16) , bodyMat);
  g.add(fuselage);

  // Pointed elongated nose
  const frontGeo = new THREE.CylinderGeometry(0.85, 0.4, 4.5, 16);
  frontGeo.rotateX(Math.PI / 2);
  const front = new THREE.Mesh(frontGeo, bodyMat);
  front.position.z = 10.2;
  g.add(front);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.4, 14), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 13.6;
  g.add(nose);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5), darkMat);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.z = 15.5;
  g.add(pitot);

  // Single-seat canopy
  const canopy = makeCanopy(0.55, 0.5, 1.5, 0x0a1828);
  canopy.position.set(0, 0.95, 8.2);
  g.add(canopy);

  // Large rectangular side air intakes, more angular
  for (const side of [1, -1]) {
    const intakeHousing = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 1.5, 7),
      bodyMat
    );
    intakeHousing.position.set(side * 1.35, -0.1, 3.0);
    g.add(intakeHousing);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 0.5), darkMat);
    mouth.position.set(side * 1.35, -0.1, 6.3);
    g.add(mouth);
  }

  // Wings: large trapezoidal, less sweep than MiG-31
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 3.2);
  wingShape.lineTo(7.0, 1.5);
  wingShape.lineTo(7.0, 0.2);
  wingShape.lineTo(0.3, -3.0);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.2, bevelEnabled: false });
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, bodyMat);
    wing.rotation.x = Math.PI / 2;
    wing.position.set(side * 1.9, -0.25, -0.5);
    wing.scale.x = side;
    g.add(wing);
    const star = makeStar(0.8);
    star.rotation.x = -Math.PI / 2;
    star.position.set(side * 4.6, 0.0, -1.0);
    g.add(star);
    for (let i = 0; i < 2; i++) {
      const m = makeMissile(3.8, 0.16);
      m.position.set(side * (2.8 + i * 1.5), -0.65, -0.6);
      g.add(m);
    }
  }

  // Twin vertical stabilizers, strongly canted outward (Foxbat signature)
  const vStabShape = new THREE.Shape();
  vStabShape.moveTo(0, 0);
  vStabShape.lineTo(1.8, 4.0);
  vStabShape.lineTo(3.2, 4.0);
  vStabShape.lineTo(4.0, 0);
  vStabShape.closePath();
  const vStabGeo = new THREE.ExtrudeGeometry(vStabShape, { depth: 0.12, bevelEnabled: false });
  for (const side of [1, -1]) {
    const vs = new THREE.Mesh(vStabGeo, bodyMat);
    vs.rotation.y = Math.PI / 2;
    vs.position.set(side * 1.5, 0.7, -5.8);
    vs.rotation.z = side * 0.22;
    g.add(vs);
    const s = makeStar(0.7);
    s.position.set(side * 1.8, 2.5, -4.8);
    s.rotation.y = side * Math.PI / 2;
    g.add(s);
  }

  const hStab = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.15, 2.6), bodyMat);
  hStab.position.set(0, 0.2, -6.5);
  g.add(hStab);

  // Twin round exhausts
  for (const side of [-1, 1]) {
    const exGroup = makeExhaust(0.55, 1.7, 0x1c1c20);
    exGroup.position.set(side * 0.65, -0.1, -8.4);
    g.add(exGroup);
  }

  // Landing gear
  g.add(makeLandingGear());

  g.scale.setScalar(SCALE);
  return { group: g, afterburners: [] };
}
