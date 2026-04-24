import * as THREE from 'three';

// ── Deterministic noise ───────────────────────────────────────────────────────
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

// ── Koordinaten-Überblick ─────────────────────────────────────────────────────
// Ursprung = Salzburg Altstadt-Mitte.  +Z = Nord, -Z = Süd (Alpen)
// Flughafen W.A. Mozart: (-1200, 420, 3200) – Nordwest
// Salzach:  ~x=0, y=418, verläuft Nord-Süd mit Kurven
// Wallersee: (4500, 428, 12500) – 15 km Nordost
// A1 Autobahn: y≈421, z≈4600, verläuft Ost-West

export function buildSalzburg(scene) {
  // --- Beleuchtung ---
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

// ── Wolken ────────────────────────────────────────────────────────────────────
function buildClouds() {
  const g = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.88, roughness: 1,
  });
  for (let i = 0; i < 50; i++) {
    const cluster = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 6);
    for (let j = 0; j < n; j++) {
      const s  = 70 + Math.random() * 130;
      const sp = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cloudMat);
      sp.position.set(
        (Math.random()-0.5)*320, (Math.random()-0.5)*45, (Math.random()-0.5)*320
      );
      cluster.add(sp);
    }
    const r = 5000 + Math.random() * 7000;
    const a = Math.random() * Math.PI * 2;
    cluster.position.set(Math.cos(a)*r, 1600+Math.random()*1400, Math.sin(a)*r);
    g.add(cluster);
  }
  return g;
}
