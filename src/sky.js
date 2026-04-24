import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function buildSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(40000);
  scene.add(sky);

  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 2.2;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.82;

  const sunPos = new THREE.Vector3();
  // Elevation 28° (morning sun over Salzburg), azimuth from south-east
  const elevation = 28;
  const azimuth = 140;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunPos.setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunPos);

  return {
    sky,
    sunDirection: sunPos.clone().normalize(),
    sunWorldPosition: sunPos.clone().multiplyScalar(5000),
  };
}
