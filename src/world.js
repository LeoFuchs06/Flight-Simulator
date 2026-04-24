import * as THREE from 'three';

// -
// AIRFIELD WORLD  -  flat terrain, proper runway 36/18, taxiways, hangars
// Runway center:  (0, 0, 0).  Runway heading 000- (north = +Z).
// Runway 36 threshold (south end): z = -1600.  Spawn heading: 000-.
// -

// - Noise helpers -
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

// - World dimensions -
const TERRAIN_SIZE = 40000;
const RWY_LEN  = 3200;   // runway length  (m)
const RWY_W    =   45;   // runway width   (m)
const FLAT_R   = 4000;   // flat-area radius around airfield  (m)

// -
export function buildSalzburg(scene) {

  // - Lighting -
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

  // - Height function  (flat at airfield, mountains far away) -
  function heightAt(x, z) {
    const d = Math.hypot(x, z);
    if (d < FLAT_R) return 0;
    const t = Math.min(1, (d - FLAT_R) / 15000);
    const st = t * t * (3 - 2 * t);   // smoothstep
    const noise = fbm(x / 5000 + 3.7, z / 5000 + 1.2, 5);
    return st * (120 + noise * 1800);
  }

  // - Terrain mesh -
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

  // - Airport surfaces -
  scene.add(buildRunway());
  scene.add(buildRunwayMarkings());
  scene.add(buildTaxiway());
  scene.add(buildApron());
  scene.add(buildRunwayLights());

  // - Structures -
  const tower = buildControlTower();
  tower.position.set(260, 0, -200);
  scene.add(tower);

  const hangars = buildHangars();
  hangars.position.set(300, 0, 320);
  scene.add(hangars);

  // - Windsock -
  const ws = buildWindsock();
  ws.position.set(120, 0, -500);
  scene.add(ws);

  // - Trees around airfield -
  scene.add(buildTrees(heightAt));

  // - Clouds -
  const clouds = buildClouds();
  scene.add(clouds);

  return {
    groundAt: heightAt,
    animate: (dt) => { clouds.rotation.y += dt * 0.0015; },
  };
}

// -
// RUNWAY
// -
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

  // - Centerline  (dashed, 15 m on / 15 m off) -
  for (let z = -RWY_LEN / 2 + 25; z < RWY_LEN / 2 - 25; z += 30) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 15), yellow);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, Y, z);
    g.add(m);
  }

  // - Threshold markings (8 parallel stripes, each end) -
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

  // - Aiming point markings (~400 m from each end, two wide bars) -
  for (const dir of [-1, 1]) {
    const az = dir * (RWY_LEN / 2 - 400);
    for (const sx of [-10, 10]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 45), white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(sx, Y, az);
      g.add(m);
    }
  }

  // - Touchdown zone markings (pairs at 150 m, 300 m, 450 m from threshold) -
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

  // - Runway edge lines -
  for (const sx of [-RWY_W / 2, RWY_W / 2]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, RWY_LEN), white);
    m.rotation.x = -Math.PI / 2;
    m.position.set(sx, Y, 0);
    g.add(m);
  }

  // - Runway number placeholders  "36" south / "18" north -
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

// - Runway lights -
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
  const papiMats = [redMat, redMat, whiteMat, whiteMat]; // 3- glide slope = 2R 2W
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.8), papiMats[i]);
    m.position.set(-RWY_W / 2 - 15 - i * 4, 0.6, papiZ);
    g.add(m);
  }

  return g;
}

// - Control tower -
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

// - Hangars -
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

// - Windsock -
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

// - Trees around the airfield -
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

// - Clouds -
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

