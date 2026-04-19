import * as THREE from 'three';

// Salzburg Altstadt center (lat/lon degrees)
export const CENTER = { lat: 47.7981, lon: 13.0465 };
const R_EARTH = 6378137;
const COS_LAT = Math.cos((CENTER.lat * Math.PI) / 180);

export function geoToLocal(lat, lon) {
  const x = ((lon - CENTER.lon) * Math.PI) / 180 * R_EARTH * COS_LAT;
  const z = ((lat - CENTER.lat) * Math.PI) / 180 * R_EARTH; // world +Z = north
  return { x, z };
}

// Tile math (XYZ slippy tiles)
function lonToTileX(lon, z) { return ((lon + 180) / 360) * Math.pow(2, z); }
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXtoLon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tileYtoLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Fetch ESRI World Imagery tiles stitched into a texture over `sizeMeters` around center.
export async function loadSatelliteTexture({ zoom = 15, gridRadius = 3 } = {}) {
  const tx = lonToTileX(CENTER.lon, zoom);
  const ty = latToTileY(CENTER.lat, zoom);
  const x0 = Math.floor(tx) - gridRadius;
  const y0 = Math.floor(ty) - gridRadius;
  const size = gridRadius * 2 + 1;

  const canvas = document.createElement('canvas');
  canvas.width = size * 256;
  canvas.height = size * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b5a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const urlTpl = (x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;

  const promises = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const tileX = x0 + dx;
      const tileY = y0 + dy;
      promises.push(loadImage(urlTpl(tileX, tileY))
        .then((img) => ctx.drawImage(img, dx * 256, dy * 256))
        .catch(() => {}));
    }
  }
  await Promise.all(promises);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.flipY = false;

  // Compute bounds in meters for correct placement
  const northLat = tileYtoLat(y0, zoom);
  const southLat = tileYtoLat(y0 + size, zoom);
  const westLon = tileXtoLon(x0, zoom);
  const eastLon = tileXtoLon(x0 + size, zoom);
  const nw = geoToLocal(northLat, westLon);
  const se = geoToLocal(southLat, eastLon);
  const width = se.x - nw.x;
  const height = nw.z - se.z; // nw.z > se.z since north=+Z
  const centerX = (nw.x + se.x) / 2;
  const centerZ = (nw.z + se.z) / 2;

  return { texture: tex, width, height, centerX, centerZ };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Apply satellite texture to a decal plane slightly above terrain center.
export function applySatelliteDecal(scene, sat, groundAt) {
  const geo = new THREE.PlaneGeometry(sat.width, sat.height, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: sat.texture, transparent: false });
  const mesh = new THREE.Mesh(geo, mat);
  // place at slightly above terrain center; use highest nearby sample to avoid z-fight
  const h = Math.max(
    groundAt(sat.centerX, sat.centerZ),
    groundAt(sat.centerX + 200, sat.centerZ),
    groundAt(sat.centerX - 200, sat.centerZ),
  );
  mesh.position.set(sat.centerX, h + 0.6, sat.centerZ);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}

// Overpass API — fetch OSM building footprints around Salzburg.
export async function loadOSMBuildings({ halfSizeMeters = 2200 } = {}) {
  // Convert meters bbox to lat/lon
  const dLat = (halfSizeMeters / R_EARTH) * (180 / Math.PI);
  const dLon = (halfSizeMeters / (R_EARTH * COS_LAT)) * (180 / Math.PI);
  const s = CENTER.lat - dLat;
  const n = CENTER.lat + dLat;
  const w = CENTER.lon - dLon;
  const e = CENTER.lon + dLon;
  const q = `[out:json][timeout:25];way["building"](${s},${w},${n},${e});out geom tags;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (const ep of endpoints) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(ep, {
        method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) continue;
      const data = await res.json();
      return data.elements || [];
    } catch { /* try next */ }
  }
  return [];
}

export function buildOSMBuildings(scene, ways, groundAt) {
  const group = new THREE.Group();
  const palette = [0xc9b89a, 0xd4c0a0, 0xbfad92, 0xd9c8a8, 0xc2b09a, 0xa89580, 0xb8a585, 0xcfbfa5];
  const roofPal = [0x7a3a2a, 0x6b2f22, 0x8a4a30, 0x5e2a1a, 0x4a2518, 0x6c3222];
  const wallMats = palette.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  const roofMats = roofPal.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));

  let built = 0;
  for (const w of ways) {
    if (!w.geometry || w.geometry.length < 3) continue;
    // Shape coords: (x, -z) so that after rotateX(-PI/2) the footprint
    // lands in the world XZ plane with correct N/S orientation.
    const pts2 = [];
    for (const node of w.geometry) {
      const p = geoToLocal(node.lat, node.lon);
      pts2.push(new THREE.Vector2(p.x, -p.z));
    }
    let sx = 0, sy = 0;
    for (const p of pts2) { sx += p.x; sy += p.y; }
    sx /= pts2.length; sy /= pts2.length;
    const recentered = pts2.map((p) => new THREE.Vector2(p.x - sx, p.y - sy));
    const shape = new THREE.Shape(recentered);
    const worldCx = sx;
    const worldCz = -sy;

    let height = 9;
    const tags = w.tags || {};
    if (tags['height']) height = parseFloat(tags['height']) || height;
    else if (tags['building:levels']) height = Math.max(3, parseFloat(tags['building:levels']) * 3.2);
    else height = 6 + Math.random() * 10;

    let geo;
    try {
      geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    } catch { continue; }
    geo.rotateX(-Math.PI / 2);
    const wallMat = wallMats[built % wallMats.length];
    const mesh = new THREE.Mesh(geo, wallMat);
    const groundY = groundAt(worldCx, worldCz);
    mesh.position.set(worldCx, groundY, worldCz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const roofGeo = new THREE.ShapeGeometry(shape);
    roofGeo.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, roofMats[built % roofMats.length]);
    roof.position.set(worldCx, groundY + height + 0.05, worldCz);
    roof.castShadow = true;
    group.add(roof);

    built++;
    if (built > 4000) break;
  }
  scene.add(group);
  return { group, count: built };
}

// Boot real-world overlays asynchronously. Never blocks startup.
export async function overlayRealSalzburg(scene, groundAt, onStatus = () => {}) {
  onStatus('Lade Satellitenbild…');
  let sat;
  try {
    sat = await loadSatelliteTexture({ zoom: 15, gridRadius: 3 });
    applySatelliteDecal(scene, sat, groundAt);
    onStatus('Satellit geladen. Lade OSM-Gebäude…');
  } catch {
    onStatus('Satellit fehlgeschlagen');
  }
  try {
    const ways = await loadOSMBuildings({ halfSizeMeters: 2200 });
    if (ways.length) {
      const r = buildOSMBuildings(scene, ways, groundAt);
      onStatus(`OSM-Gebäude: ${r.count}`);
    } else {
      onStatus('Keine OSM-Gebäude geladen');
    }
  } catch {
    onStatus('OSM fehlgeschlagen');
  }
}
