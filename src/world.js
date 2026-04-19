import * as THREE from 'three';

// Deterministic 2D noise for heightmap (value noise)
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, octaves = 5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Salzburg placement (world coords, meters):
// origin ~ center of Salzburg Altstadt, +Z = north, -Z = south (Alps)
// Airport W.A. Mozart at (-1200, 0, 3200) (north-west from city center)
// Salzach river runs roughly north-south through origin

export function buildSalzburg(scene) {
  // --- Sky: hemisphere + sun ---
  const hemi = new THREE.HemisphereLight(0xdbeeff, 0x3a5a2a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d8, 1.3);
  sun.position.set(-2500, 5000, -1500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 500;
  sun.shadow.camera.far = 15000;
  sun.shadow.camera.left = -3000;
  sun.shadow.camera.right = 3000;
  sun.shadow.camera.top = 3000;
  sun.shadow.camera.bottom = -3000;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbcd6ff, 0.25));

  // --- Terrain ---
  const TERRAIN_SIZE = 30000;
  const SEG = 256;
  const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEG, SEG);
  terrainGeo.rotateX(-Math.PI / 2);

  function heightAt(x, z) {
    // Salzburg: flat basin in the north, Alps rising towards south (-z)
    const nx = x / 4000, nz = z / 4000;
    const alpRise = THREE.MathUtils.smoothstep(-z, -500, 6000); // 0 north → 1 south
    const alps = fbm(nx * 2.1 + 9.3, nz * 2.1 + 4.7, 6) * 1800 * alpRise;
    const ridge = Math.max(0, 1 - Math.abs(fbm(nx * 0.9, nz * 0.9) - 0.5) * 6) * 800 * alpRise;
    const hills = fbm(nx * 1.2 + 2.1, nz * 1.2 + 8.9, 4) * 140;
    const basin = (1 - alpRise) * fbm(nx * 3.1, nz * 3.1, 3) * 30;

    // Festungsberg hill (fortress rock, ~120m above city)
    const fb = bump(x, z, 60, 0, 280, 120);
    // Kapuzinerberg (~250m)
    const kb = bump(x, z, 420, 220, 400, 240);
    // Mönchsberg (city rock)
    const mb = bump(x, z, -120, -40, 340, 150);

    // Salzach valley carving: dip near x≈0
    const valley = Math.exp(-(x * x) / (160 * 160)) * 18;

    // Airport: flat pad around (-1200, 3200)
    const airportFlat = flatten(x, z, -1200, 3200, 900, 420);
    if (airportFlat !== null) return airportFlat;

    let h = 420 + basin + hills + alps + ridge + fb + kb + mb - valley;
    return h;
  }

  function bump(x, z, cx, cz, radius, height) {
    const dx = x - cx, dz = z - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius) return 0;
    const t = 1 - d / radius;
    return height * t * t * (3 - 2 * t);
  }
  function flatten(x, z, cx, cz, rad, targetH) {
    const dx = x - cx, dz = z - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > rad) return null;
    return targetH;
  }

  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x3d6a2a);
  const cForest = new THREE.Color(0x2a4a1a);
  const cRock = new THREE.Color(0x6b6155);
  const cSnow = new THREE.Color(0xf2f4f8);
  const cCity = new THREE.Color(0x8a7f70);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    let c;
    const altFactor = THREE.MathUtils.smoothstep(h, 900, 2200);
    const snowFactor = THREE.MathUtils.smoothstep(h, 1600, 2400);
    if (snowFactor > 0.3) c = cRock.clone().lerp(cSnow, snowFactor);
    else if (altFactor > 0.15) c = cForest.clone().lerp(cRock, altFactor);
    else if (Math.abs(x) < 1500 && z > -1500 && z < 1500) c = cCity.clone();
    else c = cGrass.clone().lerp(cForest, Math.random() * 0.3);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // --- Salzach river ---
  const riverShape = new THREE.Shape();
  riverShape.moveTo(-60, -8000);
  const riverPoints = [];
  for (let z = -8000; z <= 8000; z += 80) {
    const curve = Math.sin(z * 0.0004) * 180 + Math.sin(z * 0.0011) * 60;
    riverPoints.push({ x: curve, z });
  }
  const riverGeo = new THREE.PlaneGeometry(120, 16000, 1, 200);
  riverGeo.rotateX(-Math.PI / 2);
  const rpos = riverGeo.attributes.position;
  for (let i = 0; i < rpos.count; i++) {
    const z = rpos.getZ(i);
    const idx = Math.max(0, Math.min(riverPoints.length - 1, Math.floor((z + 8000) / 80)));
    const curve = riverPoints[idx].x;
    rpos.setX(i, rpos.getX(i) + curve);
    rpos.setY(i, 418);
  }
  riverGeo.computeVertexNormals();
  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x1f6fa5, metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.85,
  });
  const river = new THREE.Mesh(riverGeo, riverMat);
  scene.add(river);

  // --- Hohensalzburg Fortress on Festungsberg ---
  const fortress = buildFortress();
  fortress.position.set(60, heightAt(60, 0) - 2, 0);
  scene.add(fortress);

  // --- Salzburger Dom (cathedral with dome) ---
  const dom = buildCathedral();
  dom.position.set(-80, heightAt(-80, 120) - 1, 120);
  scene.add(dom);

  // --- Altstadt buildings ---
  const city = buildCity(heightAt);
  scene.add(city);

  // --- Airport ---
  const airport = buildAirport();
  airport.position.set(-1200, 420, 3200);
  scene.add(airport);

  // --- Forests on mountain slopes ---
  const forests = buildForests(heightAt);
  scene.add(forests);

  // --- Clouds ---
  const clouds = buildClouds();
  scene.add(clouds);

  return {
    groundAt: heightAt,
    animate: (dt) => {
      clouds.rotation.y += dt * 0.003;
      riverMat.map && (riverMat.map.offset.y += dt * 0.02);
    },
  };
}

function buildFortress() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b2b1a, roughness: 0.8 });
  // Main walls
  const base = new THREE.Mesh(new THREE.BoxGeometry(120, 25, 60), wallMat);
  base.position.y = 12.5; base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  // Inner keep
  const keep = new THREE.Mesh(new THREE.BoxGeometry(60, 35, 30), wallMat);
  keep.position.set(-10, 42, 0); keep.castShadow = true;
  g.add(keep);
  // Towers
  for (const [x, z] of [[-60, -30], [60, -30], [60, 30], [-60, 30]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 40, 12), wallMat);
    t.position.set(x, 20, z); t.castShadow = true;
    g.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(12, 16, 12), roofMat);
    roof.position.set(x, 48, z); roof.castShadow = true;
    g.add(roof);
  }
  // Main tower roof
  const mainRoof = new THREE.Mesh(new THREE.BoxGeometry(62, 8, 32), roofMat);
  mainRoof.position.set(-10, 63, 0); mainRoof.castShadow = true;
  g.add(mainRoof);
  // Flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 14), new THREE.MeshStandardMaterial({ color: 0x333 }));
  pole.position.set(-10, 75, 0);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0xcc0000, side: THREE.DoubleSide }));
  flag.position.set(-6, 78, 0);
  g.add(flag);
  return g;
}

function buildCathedral() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.85 });
  const copper = new THREE.MeshStandardMaterial({ color: 0x5e9c8c, roughness: 0.5, metalness: 0.4 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(80, 30, 32), stone);
  nave.position.y = 15; nave.castShadow = true; nave.receiveShadow = true;
  g.add(nave);
  // Dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), copper);
  dome.position.set(0, 30, 0); dome.castShadow = true;
  g.add(dome);
  // Twin towers front
  for (const x of [-30, 30]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(12, 45, 12), stone);
    tw.position.set(x, 22.5, 14); tw.castShadow = true;
    g.add(tw);
    const sp = new THREE.Mesh(new THREE.ConeGeometry(8, 14, 8), copper);
    sp.position.set(x, 52, 14); sp.castShadow = true;
    g.add(sp);
  }
  return g;
}

function buildCity(heightAt) {
  const g = new THREE.Group();
  const palette = [0xc9b89a, 0xd4c0a0, 0xbfad92, 0xd9c8a8, 0xc2b09a, 0xa89580];
  const roofColors = [0x7a3a2a, 0x6b2f22, 0x8a4a30, 0x5e2a1a];
  for (let i = 0; i < 350; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const x = side * (150 + Math.random() * 1400);
    const z = -1200 + Math.random() * 2400;
    const w = 12 + Math.random() * 28;
    const d = 12 + Math.random() * 28;
    const h = 10 + Math.random() * 28;
    const mat = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const gh = heightAt(x, z);
    b.position.set(x, gh + h / 2, z);
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
    // pitched roof
    const rMat = new THREE.MeshStandardMaterial({ color: roofColors[i % roofColors.length], roughness: 0.85 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.7, 6, 4), rMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(x, gh + h + 3, z);
    roof.castShadow = true;
    g.add(roof);
  }
  return g;
}

function buildAirport() {
  const g = new THREE.Group();
  // Runway 16/34 (real orientation ≈ 160°/340°)
  const runwayLen = 2750;
  const runwayW = 45;
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 });
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(runwayW, runwayLen), asphalt);
  runway.rotation.x = -Math.PI / 2;
  runway.rotation.z = THREE.MathUtils.degToRad(-20);
  runway.position.y = 0.1;
  runway.receiveShadow = true;
  g.add(runway);
  // Center line
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = -runwayLen / 2 + 40; i < runwayLen / 2 - 40; i += 60) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 25), lineMat);
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = THREE.MathUtils.degToRad(-20);
    const a = THREE.MathUtils.degToRad(-20);
    seg.position.set(Math.sin(a) * i, 0.12, Math.cos(a) * i);
    g.add(seg);
  }
  // Threshold markings
  for (const end of [-1, 1]) {
    for (let i = -3; i <= 3; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 20), lineMat);
      s.rotation.x = -Math.PI / 2;
      s.rotation.z = THREE.MathUtils.degToRad(-20);
      const a = THREE.MathUtils.degToRad(-20);
      const baseZ = end * (runwayLen / 2 - 30);
      s.position.set(Math.sin(a) * baseZ + Math.cos(a) * i * 5, 0.12, Math.cos(a) * baseZ - Math.sin(a) * i * 5);
      g.add(s);
    }
  }
  // Terminal
  const tMat = new THREE.MeshStandardMaterial({ color: 0xc0c7cf, roughness: 0.6, metalness: 0.3 });
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(180, 20, 60), tMat);
  terminal.position.set(180, 10, 120);
  terminal.castShadow = true; terminal.receiveShadow = true;
  g.add(terminal);
  // Tower
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 40), tMat);
  tower.position.set(120, 20, 140);
  g.add(tower);
  const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(8, 6, 6), new THREE.MeshStandardMaterial({ color: 0x1a2a3a }));
  towerTop.position.set(120, 43, 140);
  g.add(towerTop);
  // Hangars
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 45), new THREE.MeshStandardMaterial({ color: 0x889098, roughness: 0.7 }));
    h.position.set(280, 9, -80 + i * 55);
    h.castShadow = true;
    g.add(h);
  }
  return g;
}

function buildForests(heightAt) {
  const count = 6000;
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 5);
  const coneGeo = new THREE.ConeGeometry(3, 9, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f3d1a, flatShading: true });
  const iTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const iLeaf = new THREE.InstancedMesh(coneGeo, leafMat, count);
  iTrunk.castShadow = false; iLeaf.castShadow = false;
  const m = new THREE.Matrix4();
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < count * 10) {
    tries++;
    const x = (Math.random() - 0.5) * 22000;
    const z = (Math.random() - 0.5) * 22000;
    const h = heightAt(x, z);
    // trees on slopes between 500m and 1800m, not on airport, not in city center
    if (h < 460 || h > 1800) continue;
    if (Math.abs(x) < 1400 && z > -1400 && z < 1400) continue;
    if (Math.hypot(x + 1200, z - 3200) < 1200) continue;
    const s = 0.7 + Math.random() * 1.2;
    m.makeScale(s, s, s);
    m.setPosition(x, h + 1.5 * s, z);
    iTrunk.setMatrixAt(placed, m);
    m.setPosition(x, h + 6 * s, z);
    iLeaf.setMatrixAt(placed, m);
    placed++;
  }
  iTrunk.count = placed; iLeaf.count = placed;
  iTrunk.instanceMatrix.needsUpdate = true;
  iLeaf.instanceMatrix.needsUpdate = true;
  const g = new THREE.Group();
  g.add(iTrunk); g.add(iLeaf);
  return g;
}

function buildClouds() {
  const g = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const cluster = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 5);
    for (let j = 0; j < n; j++) {
      const s = 80 + Math.random() * 120;
      const sp = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), cloudMat);
      sp.position.set((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 300);
      cluster.add(sp);
    }
    const r = 6000 + Math.random() * 6000;
    const a = Math.random() * Math.PI * 2;
    cluster.position.set(Math.cos(a) * r, 1800 + Math.random() * 1200, Math.sin(a) * r);
    g.add(cluster);
  }
  return g;
}
