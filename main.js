import * as THREE from 'three';
import { buildSalzburg } from './src/world.js';
import { createAircraft, AIRCRAFT_SPECS } from './src/aircraft.js';
import { Physics } from './src/physics.js';
import { CameraRig } from './src/camera.js';
import { HUD } from './src/hud.js';

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

// --- Aircraft state ---
let currentType = 'eurofighter';
let aircraft = createAircraft(currentType);
scene.add(aircraft.group);

const physics = new Physics(aircraft);
const cameraRig = new CameraRig(camera, aircraft.group);
const hud = new HUD();

// spawn over airport, heading south toward Alps
function spawn() {
  physics.reset({
    position: new THREE.Vector3(-1200, 800, 3200),
    headingDeg: 170,
    speed: 400 / 3.6, // 400 km/h in m/s
    throttle: 0.6,
  });
}
spawn();

// --- Input ---
const keys = new Set();
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
      pitch: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      roll: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      yaw: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
      throttleUp: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      throttleDown: keys.has('ControlLeft') || keys.has('ControlRight'),
      brake: keys.has('Space'),
    };
    physics.update(dt, input);
    cameraRig.update(dt, physics);
    hud.update(physics);
    // crash → reset
    if (physics.position.y < world.groundAt(physics.position.x, physics.position.z) + 3) {
      hud.flashCrash();
      spawn();
    }
  }
  world.animate(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
