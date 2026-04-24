import * as THREE from 'three';
import { buildSalzburg } from './src/world.js';
import { createAircraft, AIRCRAFT_SPECS } from './src/aircraft.js';
import { Physics } from './src/physics.js';
import { CameraRig } from './src/camera.js';
import { HUD } from './src/hud.js';
import { WeaponSystem } from './src/weapons.js';
import { overlayRealSalzburg } from './src/realWorld.js';

// Input configuration - centralized key bindings
const INPUT_CONFIG = {
  pitch: { up: 'Numpad8', down: 'Numpad5' },
  roll: { left: 'Numpad4', right: 'Numpad6' },
  yaw: { left: 'KeyQ', right: 'KeyE' },
  throttle: { up: 'KeyW', down: 'KeyS' },
  brake: 'Space',
  gear: 'KeyG',
  fireGun: 'MouseLeft',
  fireMissile: 'MouseRight',
  weaponCycle: 'MouseWheel',
  camera: 'KeyV',
  reset: 'KeyR',
  jetSelect: {
    'Digit1': 'eurofighter',
    'Digit2': 'mig31',
    'Digit3': 'mig25',
    'Digit4': 'a10',
    'Digit5': 'f22',
    'Digit6': 'f35',
  }
};

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c9ff);
scene.fog = new THREE.Fog(0x9dc7e8, 2000, 18000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 40000);

const world = buildSalzburg(scene);
const weapons = new WeaponSystem(scene, world.groundAt);

// Kick off real-Salzburg overlay (satellite + OSM buildings) in the background.
overlayRealSalzburg(scene, world.groundAt, (msg) => {
  const el = document.getElementById('hud-world');
  if (el) el.textContent = msg;
});

// --- Aircraft state ---
let currentType = 'eurofighter';
let aircraft = createAircraft(currentType);
scene.add(aircraft.group);

const physics = new Physics(aircraft);
physics._groundAt = world.groundAt; // ground support for runway roll
const cameraRig = new CameraRig(camera, aircraft.group);
const hud = new HUD();

// Runway 34 threshold (south end), heading 340° (20° west of north)
// Airport center at world (-1200, 420, 3200), runway direction sin(-20°)/cos(-20°)
const RUNWAY_POS = new THREE.Vector3(-773, 423, 2025);
const RUNWAY_HEADING = 340;

function spawn() {
  physics.gearDeployed = true;
  physics.reset({
    position: RUNWAY_POS.clone(),
    headingDeg: RUNWAY_HEADING,
    speed: 0,
    throttle: 0,
  });
  updateGearVisuals(aircraft.group, true);
}
spawn();

// --- Input ---
const keys = new Set();
const mouseBtn = { left: false, right: false };

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === INPUT_CONFIG.camera) cameraRig.cycle();
  if (e.code === INPUT_CONFIG.reset) spawn();
  if (e.code === INPUT_CONFIG.gear) {
    physics.gearDeployed = !physics.gearDeployed;
    updateGearVisuals(aircraft.group, physics.gearDeployed);
  }
  if (INPUT_CONFIG.jetSelect[e.code]) switchJet(INPUT_CONFIG.jetSelect[e.code]);
  if (e.code === INPUT_CONFIG.brake || e.code === INPUT_CONFIG.throttle.down) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// Mousewheel for weapon cycling
window.addEventListener('wheel', (e) => {
  if (document.pointerLockElement === canvas) {
    e.preventDefault();
    weapons.cycleWeapon();
    hud.setWeapon(weapons.currentWeapon);
  }
}, { passive: false });

// GTA5-style mouse: pointer lock on canvas click, mouse moves camera look
canvas.addEventListener('click', () => {
  if (running && document.pointerLockElement !== canvas) canvas.requestPointerLock();
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
  physics._groundAt = world.groundAt;
  cameraRig.bindTarget(aircraft.group);
  physics.restore(oldState);
  updateGearVisuals(aircraft.group, physics.gearDeployed);
  hud.setJetName(AIRCRAFT_SPECS[type].displayName);
}

function updateGearVisuals(group, deployed) {
  group.traverse((child) => {
    if (child.userData?.isLandingGear)    child.visible = deployed;
    if (child.userData?.isLandingGearOff) child.visible = !deployed;
  });
}

// --- Splash selection ---
const splash = document.getElementById('splash');
const hudEl = document.getElementById('hud');
document.querySelectorAll('.jet-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.jet;
    switchJet(type);
    hud.setJetName(AIRCRAFT_SPECS[type].displayName);
    splash.classList.add('hidden');
    hudEl.classList.remove('hidden');
    running = true;
    last = performance.now();
    canvas.requestPointerLock?.();
  });
});

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop ---
let running = false;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    const input = {
      pitch: (keys.has(INPUT_CONFIG.pitch.up) ? 1 : 0) - (keys.has(INPUT_CONFIG.pitch.down) ? 1 : 0),
      roll: (keys.has(INPUT_CONFIG.roll.left) ? 1 : 0) - (keys.has(INPUT_CONFIG.roll.right) ? 1 : 0),
      yaw: (keys.has(INPUT_CONFIG.yaw.right) ? 1 : 0) - (keys.has(INPUT_CONFIG.yaw.left) ? 1 : 0),
      throttleUp: keys.has(INPUT_CONFIG.throttle.up),
      throttleDown: keys.has(INPUT_CONFIG.throttle.down),
      brake: keys.has(INPUT_CONFIG.brake),
      fireGun: mouseBtn.left,
      fireMissile: mouseBtn.right,
    };
    physics.update(dt, input);
    weapons.update(dt, physics, input);
    cameraRig.update(dt, physics);
    hud.update(physics);
    const groundH = world.groundAt(physics.position.x, physics.position.z);
    const gearUp = !physics.gearDeployed;
    const hitGround = gearUp && physics.position.y < groundH + 3;
    const underground = physics.position.y < groundH - 3;
    if (hitGround || underground) {
      hud.flashCrash();
      spawn();
    }
  }
  world.animate(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
