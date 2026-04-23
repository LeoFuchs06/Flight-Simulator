import * as THREE from 'three';
import { buildSalzburg } from './src/world.js';
import { createAircraft, AIRCRAFT_SPECS } from './src/aircraft.js';
import { Physics } from './src/physics.js';
import { CameraRig } from './src/camera.js';
import { HUD } from './src/hud.js';
import { WeaponSystem } from './src/weapons.js';
import { overlayRealSalzburg } from './src/realWorld.js';
import { buildSky } from './src/sky.js';
import { buildComposer } from './src/postfx.js';
import { Contrails } from './src/contrails.js';
import { EngineAudio, SfxAudio } from './src/audio.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb8d0e5, 3000, 22000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 50000);

const skyInfo = buildSky(scene);
const world = buildSalzburg(scene);

// Align the scene's directional sun with the Sky shader's sun.
scene.traverse((o) => {
  if (o.isDirectionalLight) {
    o.position.copy(skyInfo.sunDirection).multiplyScalar(6000);
    o.target.position.set(0, 0, 0);
    o.target.updateMatrixWorld();
  }
});

// Post-processing pipeline
const pfx = buildComposer(renderer, scene, camera);

// Audio (starts on first user interaction)
const engineAudio = new EngineAudio();
const sfx = new SfxAudio(engineAudio);

const weapons = new WeaponSystem(scene, world.groundAt, sfx);
const contrails = new Contrails(scene);

// Real Salzburg overlay (async; procedural fallback on failure)
overlayRealSalzburg(scene, world.groundAt, (msg) => {
  const el = document.getElementById('hud-world');
  if (el) el.textContent = msg;
});

// --- Aircraft state ---
let currentType = 'eurofighter';
let aircraft = createAircraft(currentType);
scene.add(aircraft.group);

const physics = new Physics(aircraft);
const cameraRig = new CameraRig(camera, aircraft.group);
const hud = new HUD();

function spawn() {
  physics.reset({
    position: new THREE.Vector3(-1200, 800, 3200),
    headingDeg: 170,
    speed: 400 / 3.6,
    throttle: 0.6,
  });
}
spawn();

// --- Input ---
const keys = new Set();
const mouseBtn = { left: false, right: false };

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyV') cameraRig.cycle();
  if (e.code === 'KeyR') spawn();
  if (e.code === 'Digit1') switchJet('eurofighter');
  if (e.code === 'Digit2') switchJet('mig31');
  if (e.code === 'Digit3') switchJet('mig25');
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', async () => {
  if (running && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  await engineAudio.start();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    cameraRig.applyMouseDelta(e.movementX, e.movementY);
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseBtn.left = true;
  if (e.button === 2) mouseBtn.right = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseBtn.left = false;
  if (e.button === 2) mouseBtn.right = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function switchJet(type) {
  if (type === currentType) return;
  const oldState = physics.snapshot();
  scene.remove(aircraft.group);
  aircraft.dispose?.();
  currentType = type;
  aircraft = createAircraft(type);
  scene.add(aircraft.group);
  physics.bindAircraft(aircraft);
  cameraRig.bindTarget(aircraft.group);
  physics.restore(oldState);
  hud.setJetName(AIRCRAFT_SPECS[type].displayName);
}

const splash = document.getElementById('splash');
const hudEl = document.getElementById('hud');
document.querySelectorAll('.jet-card').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.jet;
    switchJet(type);
    hud.setJetName(AIRCRAFT_SPECS[type].displayName);
    splash.classList.add('hidden');
    hudEl.classList.remove('hidden');
    running = true;
    last = performance.now();
    await engineAudio.start();
    canvas.requestPointerLock?.();
  });
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  pfx.resize(w, h);
});

// --- Loop ---
let running = false;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    const input = {
      pitch: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      roll: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      yaw: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
      throttleUp: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      throttleDown: keys.has('ControlLeft') || keys.has('ControlRight'),
      brake: keys.has('Space'),
      fireGun: mouseBtn.left,
      fireMissile: mouseBtn.right,
    };
    physics.update(dt, input);
    weapons.update(dt, physics, input);
    contrails.update(dt, physics, world.groundAt);
    cameraRig.update(dt, physics);
    hud.update(physics);
    engineAudio.update(dt, physics.throttle, physics.speed);

    // Speed-based FOV punch (subtle "hyperspeed" feel)
    const baseFov = cameraRig.mode === 'cockpit' ? 80 : 70;
    const extra = Math.min(12, Math.max(0, physics.speed - 120) / 40);
    const targetFov = baseFov + extra;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();

    if (physics.position.y < world.groundAt(physics.position.x, physics.position.z) + 3) {
      hud.flashCrash();
      sfx.playExplosion();
      spawn();
    }
  }
  world.animate(dt);
  pfx.composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
