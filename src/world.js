import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════════
// AIRFIELD WORLD  —  flat terrain, proper runway 36/18, taxiways, hangars
// Runway center:  (0, 0, 0).  Runway heading 000° (north = +Z).
// Runway 36 threshold (south end): z = -1600.  Spawn heading: 000°.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Noise helpers ─────────────────────────────────────────────────────────────
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi+1, yi);
  const c = hash2(xi, yi+1), d = hash2(xi+1, yi+1);
  const u = smooth(xf), v = smooth(yf);
  return a*(1-u)*(1-v) + b*u*(1-v) + c*(1-u)*v + d*u*v;
}
function fbm(x, y, oct = 5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x*freq, y*freq);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

}

// ── World dimensions ──────────────────────────────────────────────────────────
const TERRAIN_SIZE = 40000;
const RWY_LEN  = 3200;   // runway length  (m)
const RWY_W    =   45;   // runway width   (m)
const FLAT_R   = 4000;   // flat-area radius around airfield  (m)

// ─────────────────────────────────────────────────────────────────────────────
export function buildSalzburg(scene) {

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xc0dcff, 0x4a7530, 0.65));
  const sun = new THREE.DirectionalLight(0xfff8e0, 1.3);
  sun.position.set(5000, 9000, 4000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 200;
  sun.shadow.camera.far  = 20000;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -5000;
  sun.shadow.camera.right = sun.shadow.camera.top   =  5000;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xb0c8ff, 0.28));

  // ── Height function  (flat at airfield, mountains far away) ──────────────
  function heightAt(x, z) {
    const d = Math.hypot(x, z);
    if (d < FLAT_R) return 0;
    const t = Math.min(1, (d - FLAT_R) / 15000);
    const st = t * t * (3 - 2 * t);   // smoothstep
    const noise = fbm(x / 5000 + 3.7, z / 5000 + 1.2, 5);
    return st * (120 + noise * 1800);
  }

  // ── Terrain mesh ──────────────────────────────────────────────────────────
  const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 256, 256);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos    = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const cGrass  = new THREE.Color(0x4f8c35);
  const cField  = new THREE.Color(0x82aa50);
  const cForest = new THREE.Color(0x2c5018);
  const cRock   = new THREE.Color(0x78685a);
  const cSnow   = new THREE.Color(0xeff3fa);
  const cTarmac = new THREE.Color(0x282828);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Is this vertex part of the airport surface?
    const onRwy   = Math.abs(x)       < RWY_W / 2 + 80 && Math.abs(z) < RWY_LEN / 2 + 300;
    const onTaxi  = Math.abs(x + 85)  < 22            && Math.abs(z) < RWY_LEN / 2 + 150;
    const onApron = Math.abs(x - 200) < 260            && z > 100 && z < 650;

    let c;
    if (onRwy || onTaxi || onApron) {
      c = cTarmac.clone();
    } else if (h > 1800) {
      c = cRock.clone().lerp(cSnow, Math.min(1, (h - 1800) / 500));
    } else if (h > 600) {
      c = cForest.clone().lerp(cRock, Math.min(1, (h - 600) / 1200));
    } else if (h > 10) {
      c = cGrass.clone().lerp(cForest, valueNoise(x / 700, z / 700) * 0.55);
    } else {
      c = cField.clone().lerp(cGrass, valueNoise(x / 400, z / 400));
    }
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  );
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ── Airport surfaces ──────────────────────────────────────────────────────
  scene.add(buildRunway());
  scene.add(buildRunwayMarkings());
  scene.add(buildTaxiway());
  scene.add(buildApron());
  scene.add(buildRunwayLights());

  // ── Structures ────────────────────────────────────────────────────────────
  const tower = buildControlTower();
  tower.position.set(260, 0, -200);
  scene.add(tower);

  const hangars = buildHangars();
  hangars.position.set(300, 0, 320);
  scene.add(hangars);

  // ── Windsock ──────────────────────────────────────────────────────────────
  const ws = buildWindsock();
  ws.position.set(120, 0, -500);
  scene.add(ws);

  // ── Trees around airfield ─────────────────────────────────────────────────
  scene.add(buildTrees(heightAt));

  // ── Clouds ────────────────────────────────────────────────────────────────
  const clouds = buildClouds();
  scene.add(clouds);

  return {
    groundAt: heightAt,
    animate: (dt) => { clouds.rotation.y += dt * 0.0015; },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNWAY
// ─────────────────────────────────────────────────────────────────────────────
function buildRunway() {
  // Main asphalt strip
  const geo = new THREE.PlaneGeometry(RWY_W, RWY_LEN);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.92, metalness: 0 }),
  );
  mesh.position.y = 0.05;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRunwayMarkings() {
  const g = new THREE.Group();
  const white  = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffe868 });
  const Y = 0.10;   // just above tarmac

  // ── Centerline  (dashed, 15 m on / 15 m off) ─────────────────────────────
  for (let z = -RWY_LEN / 2 + 25; z < RWY_LEN / 2 - 25; z += 30) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 15), yellow);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, Y, z);
    g.add(m);
  }

  // ── Threshold markings (8 parallel stripes, each end) ────────────────────
  const STRIPE_W = 3.6, STRIPE_L = 30, GAP = 1.8;
  const totalW = 8 * STRIPE_W + 7 * GAP;
  for (const dir of [-1, 1]) {
    const thZ = dir * (RWY_LEN / 2 - 65);
    for (let i = 0; i < 8; i++) {
      const sx = -totalW / 2 + i * (STRIPE_W + GAP) + STRIPE_W / 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(STRIPE_W, STRIPE_L), white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(sx, Y, thZ);
      g.add(m);
    }
  }

  // ── Aiming point markings (~400 m from each end, two wide bars) ──────────
  for (const dir of [-1, 1]) {
    const az = dir * (RWY_LEN / 2 - 400);
    for (const sx of [-10, 10]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 45), white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(sx, Y, az);
      g.add(m);
    }
  }

  // ── Touchdown zone markings (pairs at 150 m, 300 m, 450 m from threshold) ─
  for (const dir of [-1, 1]) {
    for (const offset of [150, 300, 450]) {
      const tz = dir * (RWY_LEN / 2 - offset);
      for (const sx of [-14, 14]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 22), white);
        m.rotation.x = -Math.PI / 2;
        m.position.set(sx, Y, tz);
        g.add(m);
      }
    }
  }

  // ── Runway edge lines ─────────────────────────────────────────────────────
  for (const sx of [-RWY_W / 2, RWY_W / 2]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, RWY_LEN), white);
    m.rotation.x = -Math.PI / 2;
    m.position.set(sx, Y, 0);
    g.add(m);
  }

  // ── Runway number placeholders  "36" south / "18" north ──────────────────
  // Two thick white bars at each end represent the number block
  for (const dir of [-1, 1]) {
    const nz = dir * (RWY_LEN / 2 - 130);
    const rot = dir === 1 ? Math.PI : 0;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), white);
    bar.rotation.x = -Math.PI / 2;
    bar.rotation.z = rot;
    bar.position.set(0, Y, nz);
    g.add(bar);
    const bar2 = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), white);
    bar2.rotation.x = -Math.PI / 2;
    bar2.rotation.z = rot;
    bar2.position.set(0, Y, nz + dir * 6);
    g.add(bar2);
  }

  return g;
}

function buildTaxiway() {
  const g = new THREE.Group();
  const tMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const yMat = new THREE.MeshBasicMaterial({ color: 0xffe868 });

  // Main parallel taxiway (west side)
  const tw = new THREE.Mesh(new THREE.PlaneGeometry(20, RWY_LEN + 500), tMat);
  tw.rotation.x = -Math.PI / 2;
  tw.position.set(-85, 0.04, 0);
  g.add(tw);

  // Connector at south end
  for (const cz of [-RWY_LEN / 2, 0, RWY_LEN / 2]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(65, 20), tMat);
    c.rotation.x = -Math.PI / 2;
    c.position.set(-42, 0.04, cz);
    g.add(c);
  }

  // Taxiway centerline (yellow dashed)
  for (let z = -RWY_LEN / 2 - 220; z < RWY_LEN / 2 + 230; z += 20) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 10), yMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(-85, 0.08, z);
    g.add(d);
  }

  return g;
}

function buildApron() {
  const g = new THREE.Group();
  const aMat = new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.88 });
  const yMat = new THREE.MeshBasicMaterial({ color: 0xffe868 });

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(420, 540), aMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(200, 0.03, 350);
  g.add(apron);

  // Parking spots (yellow box lines)
  for (let i = 0; i < 6; i++) {
    const sx = 60 + i * 60;
    // Front edge line
    const front = new THREE.Mesh(new THREE.PlaneGeometry(50, 0.6), yMat);
    front.rotation.x = -Math.PI / 2;
    front.position.set(sx, 0.08, 130);
    g.add(front);
    // Side lines
    for (const side of [-1, 1]) {
      const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 25), yMat);
      sl.rotation.x = -Math.PI / 2;
      sl.position.set(sx + side * 25, 0.08, 143);
      g.add(sl);
    }
  }

  return g;
}

// ── Runway lights ─────────────────────────────────────────────────────────────
function buildRunwayLights() {
  const g = new THREE.Group();
  const gGeo = new THREE.SphereGeometry(0.32, 6, 4);
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
  const redMat   = new THREE.MeshBasicMaterial({ color: 0xff2a18 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xfff8e0 });

  const edgeSpacing = 8;
  const count = Math.floor(RWY_W / edgeSpacing) + 1;

  // Threshold lights (green inbound, red outbound at each end)
  for (let i = 0; i <= count; i++) {
    const x = -RWY_W / 2 + i * edgeSpacing;
    [-RWY_LEN / 2, RWY_LEN / 2].forEach((z, idx) => {
      const m = new THREE.Mesh(gGeo, idx === 0 ? greenMat : redMat);
      m.position.set(x, 0.4, z);
      g.add(m);
    });
  }

  // Edge lights (white, every 60 m along both sides)
  for (let z = -RWY_LEN / 2 + 60; z < RWY_LEN / 2; z += 60) {
    for (const sx of [-RWY_W / 2 - 1.5, RWY_W / 2 + 1.5]) {
      const m = new THREE.Mesh(gGeo, whiteMat);
      m.position.set(sx, 0.35, z);
      g.add(m);
    }
  }

  // PAPI lights west side (~400 m from south threshold)
  const papiZ = -RWY_LEN / 2 + 400;
  const papiMats = [redMat, redMat, whiteMat, whiteMat]; // 3° glide slope = 2R 2W
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.8), papiMats[i]);
    m.position.set(-RWY_W / 2 - 15 - i * 4, 0.6, papiZ);
    g.add(m);
  }

  return g;
}

// ── Control tower ─────────────────────────────────────────────────────────────
function buildControlTower() {
  const g = new THREE.Group();
  const concMat = new THREE.MeshStandardMaterial({ color: 0xd4cec4, roughness: 0.75 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a4060, metalness: 0.5, roughness: 0.15,
    transparent: true, opacity: 0.72, side: THREE.DoubleSide,
  });

  // Base building
  const base = new THREE.Mesh(new THREE.BoxGeometry(32, 7, 22), concMat);
  base.position.y = 3.5;
  g.add(base);

  // Shaft
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(9, 42, 9), concMat);
  shaft.position.y = 24.5;
  g.add(shaft);

  // Cab (observation deck)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 16), concMat);
  cab.position.y = 48;
  g.add(cab);

  // Glass wrap
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 4, 18, 1, true), glassMat);
  glass.position.y = 48;
  g.add(glass);

  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 1.5, 17), concMat);
  roof.position.y = 51.5;
  g.add(roof);

  // Antenna
  const ant = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888 }),
  );
  ant.position.y = 57;
  g.add(ant);

  // Radar dish
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.4, 16, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.6, roughness: 0.4 }),
  );
  dish.rotation.z = Math.PI / 2;
  dish.position.set(4, 53, 0);
  g.add(dish);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ── Hangars ───────────────────────────────────────────────────────────────────
function buildHangars() {
  const g = new THREE.Group();
  const wallMat  = new THREE.MeshStandardMaterial({ color: 0x8898a8, metalness: 0.35, roughness: 0.65 });
  const roofMat  = new THREE.MeshStandardMaterial({ color: 0x607888, metalness: 0.45, roughness: 0.55 });
  const doorMat  = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.5, roughness: 0.5 });

  for (let i = 0; i < 3; i++) {
    const hg = new THREE.Group();

    const walls = new THREE.Mesh(new THREE.BoxGeometry(52, 18, 42), wallMat);
    walls.position.y = 9;
    hg.add(walls);

    // Barrel roof
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(27, 27, 52, 14, 1, false, 0, Math.PI),
      roofMat,
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 18;
    hg.add(roof);

    // Door panels
    for (const dx of [-12, 12]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(22, 16, 0.5), doorMat);
      door.position.set(dx, 8, -21);
      hg.add(door);
    }

    hg.position.set(i * 65 - 65, 0, 0);
    hg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(hg);
  }
  return g;
}

// ── Windsock ──────────────────────────────────────────────────────────────────
function buildWindsock() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 10, 8), poleMat);
  pole.position.y = 5;
  g.add(pole);

  // Cone (open-ended sock)
  const sockMat = new THREE.MeshStandardMaterial({
    color: 0xff4820, side: THREE.DoubleSide, roughness: 0.7,
  });
  const sock = new THREE.Mesh(new THREE.ConeGeometry(1.0, 4, 12, 1, true), sockMat);
  sock.rotation.z = -Math.PI / 2;
  sock.position.set(2, 10, 0);
  g.add(sock);

  return g;
}

// ── Trees around the airfield ─────────────────────────────────────────────────
function buildTrees(heightAt) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e12, roughness: 0.9 });
  const leafMat  = new THREE.MeshStandardMaterial({ color: 0x2e5c18, roughness: 0.85 });

  const rng = (a, b) => a + Math.random() * (b - a);
  const TREE_COUNT = 300;

  for (let i = 0; i < TREE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = rng(1800, 9000);
    const tx    = Math.cos(angle) * dist;
    const tz    = Math.sin(angle) * dist;

    // Skip runway corridor
    if (Math.abs(tx) < 200 && Math.abs(tz) < RWY_LEN / 2 + 500) continue;

    const h  = rng(4, 14);
    const ty = heightAt(tx, tz);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, h, 6), trunkMat);
    trunk.position.set(tx, ty + h / 2, tz);
    trunk.castShadow = true;
    g.add(trunk);

    const leafSize = rng(2.8, 6.5);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(leafSize, leafSize * 1.8, 7), leafMat);
    leaf.position.set(tx, ty + h + leafSize * 0.6, tz);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

// ── Clouds ────────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xdbeeff, 0x3a5a2a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d8, 1.3);
  sun.position.set(-2500, 5000, -1500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 500;
  sun.shadow.camera.far  = 15000;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -3000;
  sun.shadow.camera.right = sun.shadow.camera.top   =  3000;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbcd6ff, 0.25));

  // --- Terrain ---
  const TERRAIN_SIZE = 30000;
  const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 256, 256);
  terrainGeo.rotateX(-Math.PI / 2);

  function bump(x, z, cx, cz, radius, height) {
    const d = Math.hypot(x - cx, z - cz);
    if (d > radius) return 0;
    const t = 1 - d / radius;
    return height * t * t * (3 - 2 * t);
  }
  function flatten(x, z, cx, cz, rad, h) {
    return Math.hypot(x - cx, z - cz) <= rad ? h : null;
  }

  // Fluss-Kurve für Brücken-Positionierung
  function riverCurveAt(z) {
    return Math.sin(z * 0.0004) * 180 + Math.sin(z * 0.0011) * 60;
  }

  function heightAt(x, z) {
    const nx = x / 4000, nz = z / 4000;
    const alpRise = THREE.MathUtils.smoothstep(-z, -500, 6000);
    const alps  = fbm(nx*2.1+9.3, nz*2.1+4.7, 6) * 1800 * alpRise;
    const ridge = Math.max(0, 1 - Math.abs(fbm(nx*0.9, nz*0.9) - 0.5) * 6) * 800 * alpRise;
    const hills = fbm(nx*1.2+2.1, nz*1.2+8.9, 4) * 140;
    const basin = (1 - alpRise) * fbm(nx*3.1, nz*3.1, 3) * 30;

    const fb = bump(x, z,   60,    0, 280, 120); // Festungsberg
    const kb = bump(x, z,  420,  220, 400, 240); // Kapuzinerberg
    const mb = bump(x, z, -120,  -40, 340, 150); // Mönchsberg
    const ub = bump(x, z, -800,-6500,3500,1400); // Untersberg (markant)

    const valley = Math.exp(-(x*x)/(160*160)) * 18;

    // Flache Zonen
    const ap = flatten(x, z, -1200, 3200, 900, 420);  // Flughafen
    if (ap !== null) return ap;
    const wl = flatten(x, z,  4500,12500,2200, 428);  // Wallersee
    if (wl !== null) return wl;

    return 420 + basin + hills + alps + ridge + fb + kb + mb + ub - valley;
  }

  // Terrain-Farben
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass  = new THREE.Color(0x4a7a30);
  const cField  = new THREE.Color(0x8aaa50); // Felder/Ackerland
  const cForest = new THREE.Color(0x2a4a1a);
  const cRock   = new THREE.Color(0x6b6155);
  const cSnow   = new THREE.Color(0xf2f4f8);
  const cCity   = new THREE.Color(0x8a7f70);
  const cAsphalt = new THREE.Color(0x303030);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    const altFactor  = THREE.MathUtils.smoothstep(h, 900, 2200);
    const snowFactor = THREE.MathUtils.smoothstep(h, 1600, 2400);
    const isAirport  = Math.hypot(x + 1200, z - 3200) < 950;
    const isCity     = Math.abs(x) < 1600 && z > -1600 && z < 1800;
    const isNorthFlat = h < 480 && z > 2000 && !isAirport;

    let c;
    if (isAirport)       c = cAsphalt.clone().lerp(cCity, 0.4);
    else if (snowFactor > 0.3) c = cRock.clone().lerp(cSnow, snowFactor);
    else if (altFactor > 0.15) c = cForest.clone().lerp(cRock, altFactor);
    else if (isCity)     c = cCity.clone();
    else if (isNorthFlat) c = cField.clone().lerp(cGrass, Math.random() * 0.4);
    else                  c = cGrass.clone().lerp(cForest, Math.random() * 0.3);

    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  );
  terrain.receiveShadow = true;
  scene.add(terrain);

  // --- Salzach ---
  const riverPoints = [];
  for (let z = -9000; z <= 9000; z += 80) {
    riverPoints.push({ x: riverCurveAt(z), z });
  }
  const riverGeo = new THREE.PlaneGeometry(130, 18000, 1, 225);
  riverGeo.rotateX(-Math.PI / 2);
  const rpos = riverGeo.attributes.position;
  for (let i = 0; i < rpos.count; i++) {
    const rz  = rpos.getZ(i);
    const idx = Math.max(0, Math.min(riverPoints.length-1, Math.floor((rz+9000)/80)));
    rpos.setX(i, rpos.getX(i) + riverPoints[idx].x);
    rpos.setY(i, 418);
  }
  riverGeo.computeVertexNormals();
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x1f6fa5, metalness: 0.25, roughness: 0.25, transparent: true, opacity: 0.88,
  });
  scene.add(new THREE.Mesh(riverGeo, riverMat));

  // --- Wallersee ---
  scene.add(buildWallersee());

  // --- Hohensalzburg ---
  const fortress = buildFortress();
  fortress.position.set(60, heightAt(60, 0) - 2, 0);
  scene.add(fortress);

  // --- Salzburger Dom ---
  const dom = buildCathedral();
  dom.position.set(-80, heightAt(-80, 120) - 1, 120);
  scene.add(dom);

  // --- Stadtgebäude ---
  scene.add(buildCity(heightAt));

  // --- Flughafen ---
  const airport = buildAirport();
  airport.position.set(-1200, 420, 3200);
  scene.add(airport);

  // --- Straßen & Autobahn ---
  scene.add(buildRoads(heightAt));

  // --- Brücken über die Salzach ---
  scene.add(buildBridges(heightAt, riverCurveAt));

  // --- Wälder ---
  scene.add(buildForests(heightAt));

  // --- Wolken ---
  const clouds = buildClouds();
  scene.add(clouds);

  return {
    groundAt: heightAt,
    animate: (dt) => { clouds.rotation.y += dt * 0.003; },
  };
}

// ── Wallersee ─────────────────────────────────────────────────────────────────
function buildWallersee() {
  const g = new THREE.Group();
  // Haupt-Seefläche (Ellipse via skaliertes PlaneGeo)
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a78b5, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.9,
  });
  const lake = new THREE.Mesh(geo, mat);
  lake.scale.set(1600, 1, 4200);
  lake.position.set(4500, 429, 12500);
  g.add(lake);
  return g;
}

// ── Straßen & Autobahn ────────────────────────────────────────────────────────
function buildRoads(heightAt) {
  const g = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.95 });
  const yellow  = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  const white   = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // A1 Autobahn – Ost-West, nördlich der Stadt
  const A1_Z = 4600, A1_W = 28, A1_LEN = 16000;
  const a1 = new THREE.Mesh(new THREE.PlaneGeometry(A1_LEN, A1_W), asphalt);
  a1.rotation.x = -Math.PI / 2;
  a1.position.set(0, 421, A1_Z);
  g.add(a1);

  // Mittellinie A1 (gelb, gestrichelt)
  for (let x = -A1_LEN/2 + 50; x < A1_LEN/2 - 50; x += 80) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.6), yellow);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(x, 422, A1_Z);
    g.add(seg);
  }

  // Zufahrtsstraße Flughafen ↔ Stadt (schräg, ~160m Länge)
  function addRoad(x1, z1, x2, z2, width, yOff = 420.5) {
    const dx = x2-x1, dz = z2-z1;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    const cy = heightAt((x1+x2)/2, (z1+z2)/2) + yOff - heightAt((x1+x2)/2, (z1+z2)/2) + yOff;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(width, len), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = angle;
    road.position.set((x1+x2)/2, yOff, (z1+z2)/2);
    g.add(road);
  }

  // Verbindungsstraße Altstadt ↔ Flughafen
  addRoad(  -300, 1800, -1100, 3000, 14, 421);
  // Stadteinfahrt Ost
  addRoad(  1200,  -800,  3000, -800,  12, 421);
  // Verbindung Autobahn ↔ Flughafen
  addRoad( -1200, 3200, -1200, 4600,  14, 421);

  return g;
}

// ── Brücken über die Salzach ──────────────────────────────────────────────────
function buildBridges(heightAt, riverCurveAt) {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb0a898, roughness: 0.85 });
  const railing  = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 });
  const road     = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });

  const BRIDGES = [
    { z: -300,  name: 'Staatsbrücke' },
    { z:  400,  name: 'Mozartbrücke' },
    { z:  900,  name: 'Makartsteg' },
    { z: 2000,  name: 'Müllner Steg' },
  ];

  for (const { z } of BRIDGES) {
    const rx = riverCurveAt(z);
    const ry = heightAt(rx, z) + 1;
    const bg = new THREE.Group();

    // Brückenfahrbahn
    const deck = new THREE.Mesh(new THREE.BoxGeometry(160, 1.5, 12), concrete);
    deck.position.set(0, 0, 0);
    bg.add(deck);

    // Fahrbahn oben
    const roadway = new THREE.Mesh(new THREE.BoxGeometry(156, 0.4, 10), road);
    roadway.position.y = 0.95;
    bg.add(roadway);

    // Geländer (links + rechts)
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(158, 1.2, 0.3), railing);
      rail.position.set(0, 1.5, side * 5.5);
      bg.add(rail);
      // Pfosten
      for (let bx = -75; bx <= 75; bx += 15) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3), railing);
        post.position.set(bx, 1.2, side * 5.5);
        bg.add(post);
      }
    }

    // Brückenpfeiler (2 Stück)
    for (const px of [-35, 35]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 8), concrete);
      pier.position.set(px, -4.5, 0);
      bg.add(pier);
    }

    bg.position.set(rx, ry, z);
    g.add(bg);
  }
  return g;
}

// ── Hohensalzburg Festung ─────────────────────────────────────────────────────
function buildFortress() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b2b1a, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(120, 25, 60), wallMat);
  base.position.y = 12.5; base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const keep = new THREE.Mesh(new THREE.BoxGeometry(60, 35, 30), wallMat);
  keep.position.set(-10, 42, 0); keep.castShadow = true;
  g.add(keep);
  for (const [x, z] of [[-60,-30],[60,-30],[60,30],[-60,30]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(10,12,40,12), wallMat);
    t.position.set(x, 20, z); t.castShadow = true; g.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(12,16,12), roofMat);
    roof.position.set(x, 48, z); roof.castShadow = true; g.add(roof);
  }
  const mainRoof = new THREE.Mesh(new THREE.BoxGeometry(62,8,32), roofMat);
  mainRoof.position.set(-10, 63, 0); mainRoof.castShadow = true; g.add(mainRoof);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,14),
    new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.set(-10, 75, 0); g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(8,5),
    new THREE.MeshStandardMaterial({ color: 0xcc0000, side: THREE.DoubleSide }));
  flag.position.set(-6, 78, 0); g.add(flag);
  return g;
}

// ── Salzburger Dom ────────────────────────────────────────────────────────────
function buildCathedral() {
  const g = new THREE.Group();
  const stone  = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.85 });
  const copper = new THREE.MeshStandardMaterial({ color: 0x5e9c8c, roughness: 0.5, metalness: 0.4 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(80,30,32), stone);
  nave.position.y = 15; nave.castShadow = true; nave.receiveShadow = true; g.add(nave);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(14,24,16, 0,Math.PI*2, 0,Math.PI/2), copper);
  dome.position.set(0, 30, 0); dome.castShadow = true; g.add(dome);
  for (const x of [-30, 30]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(12,45,12), stone);
    tw.position.set(x, 22.5, 14); tw.castShadow = true; g.add(tw);
    const sp = new THREE.Mesh(new THREE.ConeGeometry(8,14,8), copper);
    sp.position.set(x, 52, 14); sp.castShadow = true; g.add(sp);
  }
  return g;
}

// ── Stadtgebäude ──────────────────────────────────────────────────────────────
function buildCity(heightAt) {
  const g = new THREE.Group();
  const palette   = [0xc9b89a, 0xd4c0a0, 0xbfad92, 0xd9c8a8, 0xc2b09a, 0xa89580, 0xccc0a8];
  const roofCols  = [0x7a3a2a, 0x6b2f22, 0x8a4a30, 0x5e2a1a, 0x903820];
  const rng = (min, max) => min + Math.random() * (max - min);

  // Altstadt-Kern (dicht, niedrig)
  for (let i = 0; i < 220; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r     = 80 + Math.random() * 600;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const w = rng(10, 24), d = rng(10, 24), h = rng(8, 22);
    const mat = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const gh = heightAt(x, z);
    b.position.set(x, gh + h/2, z); b.castShadow = true; b.receiveShadow = true;
    g.add(b);
    const rMat = new THREE.MeshStandardMaterial({ color: roofCols[i % roofCols.length], roughness: 0.85 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*0.72, 5, 4), rMat);
    roof.rotation.y = Math.PI/4; roof.position.set(x, gh+h+2.5, z); roof.castShadow = true;
    g.add(roof);
  }

  // Vorstadt (weiter gestreut, etwas größer)
  for (let i = 0; i < 280; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const x = side * rng(500, 2400);
    const z = rng(-2000, 3500);
    if (Math.hypot(x+1200, z-3200) < 1100) continue; // Flughafen meiden
    const w = rng(14, 35), d = rng(14, 35), h = rng(10, 32);
    const mat = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const gh = heightAt(x, z);
    b.position.set(x, gh+h/2, z); b.castShadow = true; b.receiveShadow = true;
    g.add(b);
    const rMat = new THREE.MeshStandardMaterial({ color: roofCols[i % roofCols.length], roughness: 0.85 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*0.68, 6, 4), rMat);
    roof.rotation.y = Math.PI/4; roof.position.set(x, gh+h+3, z); roof.castShadow = true;
    g.add(roof);
  }

  // Gewerbegebiet Norden (flache Hallen nahe Flughafen)
  for (let i = 0; i < 18; i++) {
    const x = rng(-2500, -600), z = rng(1800, 3000);
    const w = rng(40, 90), d = rng(30, 60), h = rng(6, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aacb8, roughness: 0.7, metalness: 0.2 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const gh = heightAt(x, z);
    b.position.set(x, gh+h/2, z); b.castShadow = true; g.add(b);
  }

  return g;
}

// ── Flughafen ────────────────────────────────────────────────────────────────
function buildAirport() {
  const g = new THREE.Group();
  const asphalt  = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 });
  const taxiMat  = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.9 });
  const white    = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const yellow   = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
  const green    = new THREE.MeshBasicMaterial({ color: 0x44ff44 });

  const RWY_LEN = 2750, RWY_W = 45;
  const ANGLE   = THREE.MathUtils.degToRad(-20);
  const sa = Math.sin(ANGLE), ca = Math.cos(ANGLE);

  // ── Piste ──
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RWY_W, RWY_LEN), asphalt);
  runway.rotation.x = -Math.PI/2; runway.rotation.z = ANGLE;
  runway.position.y = 0.1; runway.receiveShadow = true;
  g.add(runway);

  // Mittellinie
  for (let i = -RWY_LEN/2+40; i < RWY_LEN/2-40; i += 60) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 25), white);
    seg.rotation.x = -Math.PI/2; seg.rotation.z = ANGLE;
    seg.position.set(sa*i, 0.12, ca*i);
    g.add(seg);
  }

  // Schwellenschwellen
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 20), white);
      s.rotation.x = -Math.PI/2; s.rotation.z = ANGLE;
      const bz = end * (RWY_LEN/2 - 30);
      s.position.set(sa*bz + ca*k*5, 0.12, ca*bz - sa*k*5);
      g.add(s);
    }
  }

  // Pistenrandstreifen
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(2, RWY_LEN - 40), white);
    edge.rotation.x = -Math.PI/2; edge.rotation.z = ANGLE;
    edge.position.set(ca * side * (RWY_W/2 - 1), 0.11, -sa * side * (RWY_W/2 - 1));
    g.add(edge);
  }

  // ── Rollweg (Taxiway) parallel zur Piste, Richtung Terminal ──
  const TWY_OFFSET_X = -120, TWY_OFFSET_Z = 30;
  const taxiway = new THREE.Mesh(new THREE.PlaneGeometry(18, RWY_LEN * 0.85), taxiMat);
  taxiway.rotation.x = -Math.PI/2; taxiway.rotation.z = ANGLE;
  taxiway.position.set(
    TWY_OFFSET_X * ca + TWY_OFFSET_Z * sa,
    0.08,
    -TWY_OFFSET_X * sa + TWY_OFFSET_Z * ca
  );
  g.add(taxiway);

  // Gelbe Mittellinie Rollweg
  for (let i = -RWY_LEN*0.42; i < RWY_LEN*0.42; i += 40) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 18), yellow);
    seg.rotation.x = -Math.PI/2; seg.rotation.z = ANGLE;
    const bx = TWY_OFFSET_X * ca + TWY_OFFSET_Z * sa;
    const bz = -TWY_OFFSET_X * sa + TWY_OFFSET_Z * ca;
    seg.position.set(bx + sa*i, 0.1, bz + ca*i);
    g.add(seg);
  }

  // Abrollwege (verbinden Piste mit Rollweg)
  for (const atPct of [-0.35, 0, 0.35]) {
    const pi = RWY_LEN * atPct;
    const conn = new THREE.Mesh(new THREE.PlaneGeometry(130, 15), taxiMat);
    conn.rotation.x = -Math.PI/2;
    conn.rotation.z = ANGLE + Math.PI/4; // diagonal
    const cx = sa*pi + (TWY_OFFSET_X*ca + TWY_OFFSET_Z*sa)/2;
    const cz = ca*pi + (-TWY_OFFSET_X*sa + TWY_OFFSET_Z*ca)/2;
    conn.position.set(cx, 0.09, cz);
    g.add(conn);
  }

  // ── Vorfeld (Apron) nahe Terminal ──
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 140), taxiMat);
  apron.rotation.x = -Math.PI/2;
  apron.position.set(140, 0.05, 80);
  g.add(apron);

  // Parkpositionen (gelbe Markierungen)
  for (let slot = 0; slot < 7; slot++) {
    const sx = -100 + slot * 38;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 28), yellow);
    line.rotation.x = -Math.PI/2; line.position.set(sx, 0.1, 80);
    g.add(line);
  }

  // ── Anflugbefeuerung (PAPI-Lichter) ──
  for (const side of [-1, 1]) {
    for (let li = 0; li < 4; li++) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.4, 1.2),
        new THREE.MeshBasicMaterial({ color: li < 2 ? 0xff2200 : 0xffffff })
      );
      const distFromThresh = -RWY_LEN/2 - 20;
      light.position.set(
        sa*distFromThresh + ca*(side*(RWY_W/2 + 8 + li*2.5)),
        0.4,
        ca*distFromThresh - sa*(side*(RWY_W/2 + 8 + li*2.5))
      );
      g.add(light);
    }
  }

  // Anfluglichter (ILS-Lichterkette, grün)
  for (let li = 1; li <= 10; li++) {
    const dist = -RWY_LEN/2 - li*28;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(18, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    bar.rotation.x = -Math.PI/2; bar.rotation.z = ANGLE;
    bar.position.set(sa*dist, 0.3, ca*dist);
    g.add(bar);
  }

  // ── Terminal ──
  const tMat = new THREE.MeshStandardMaterial({ color: 0xc0c7cf, roughness: 0.6, metalness: 0.3 });
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(180, 20, 60), tMat);
  terminal.position.set(200, 10, 120); terminal.castShadow = true; terminal.receiveShadow = true;
  g.add(terminal);

  // Glas-Fassade Terminal
  const glassFront = new THREE.Mesh(new THREE.BoxGeometry(180, 18, 2),
    new THREE.MeshStandardMaterial({ color: 0x7ab0d0, metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.7 }));
  glassFront.position.set(200, 9, 90);
  g.add(glassFront);

  // Tower
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 42), tMat);
  tower.position.set(130, 21, 145); g.add(tower);
  const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 7),
    new THREE.MeshStandardMaterial({ color: 0x1a2a3a }));
  towerTop.position.set(130, 45, 145); g.add(towerTop);

  // Windsack
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10),
    new THREE.MeshStandardMaterial({ color: 0x999999 }));
  sockPole.position.set(-350, 5, -350); g.add(sockPole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6600 }));
  sock.rotation.z = Math.PI/2; sock.position.set(-348, 10, -350); g.add(sock);

  // Hangars
  for (let i = 0; i < 4; i++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(65, 20, 50),
      new THREE.MeshStandardMaterial({ color: 0x7a8898, roughness: 0.7, metalness: 0.2 }));
    h.position.set(340, 10, -100 + i*60); h.castShadow = true;
    g.add(h);
  }

  return g;
}

// ── Wälder ────────────────────────────────────────────────────────────────────
function buildForests(heightAt) {
  const count = 7000;
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 5);
  const coneGeo  = new THREE.ConeGeometry(3, 9, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a });
  const leafMat  = new THREE.MeshStandardMaterial({ color: 0x1f3d1a, flatShading: true });
  const iTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const iLeaf  = new THREE.InstancedMesh(coneGeo,  leafMat,  count);
  iTrunk.castShadow = false; iLeaf.castShadow = false;
  const m = new THREE.Matrix4();
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 12) {
    tries++;
    const x = (Math.random() - 0.5) * 22000;
    const z = (Math.random() - 0.5) * 22000;
    const h = heightAt(x, z);
    if (h < 455 || h > 1800) continue;
    if (Math.abs(x) < 1600 && z > -1600 && z < 2000) continue;
    if (Math.hypot(x+1200, z-3200) < 1300) continue;
    if (Math.hypot(x-4500, z-12500) < 2600) continue; // Wallersee freihalten
    const s = 0.7 + Math.random() * 1.2;
    m.makeScale(s, s, s); m.setPosition(x, h+1.5*s, z);
    iTrunk.setMatrixAt(placed, m);
    m.setPosition(x, h+6*s, z);
    iLeaf.setMatrixAt(placed, m);
    placed++;
  }
  iTrunk.count = placed; iLeaf.count = placed;
  iTrunk.instanceMatrix.needsUpdate = true;
  iLeaf.instanceMatrix.needsUpdate  = true;
  const g = new THREE.Group();
  g.add(iTrunk); g.add(iLeaf);
  return g;
}

// ── Clouds ────────────────────────────────────────────────────────────────────
function buildClouds() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.84, roughness: 1,
  });
  const rng = (a, b) => a + Math.random() * (b - a);

  for (let i = 0; i < 40; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 6);
    for (let p = 0; p < puffs; p++) {
      const r = rng(220, 750);
      const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat);
      sp.position.set(rng(-r, r) * 1.4, rng(-r * 0.25, r * 0.25), rng(-r, r));
      sp.scale.y = 0.5;
      cloud.add(sp);
    }
    const angle = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
    const dist  = rng(5000, 16000);
    cloud.position.set(
      Math.cos(angle) * dist,
      rng(1400, 3800),
      Math.sin(angle) * dist,
    );
    g.add(cloud);
  }
  return g;
}

