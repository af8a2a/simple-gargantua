import * as THREE from '../lib/three.module.js';
import { blackholeVertexShader, blackholeFragmentShader } from './shaders.js';

const QUALITY = {
  ultra: { steps: 420, scale: 1.0 },
  high: { steps: 280, scale: 0.85 },
  medium: { steps: 180, scale: 0.7 },
  low: { steps: 100, scale: 0.5 },
};

const M = 0.5;

function horizonR(aStar) {
  aStar = Math.min(Math.abs(aStar), 0.998);
  return M * (1 + Math.sqrt(Math.max(1 - aStar * aStar, 0)));
}

function iscoR(aStar) {
  aStar = Math.min(Math.abs(aStar), 0.998);
  const aa = aStar * aStar;
  const z1 =
    1 +
    Math.cbrt(Math.max(1 - aa, 0)) *
      (Math.cbrt(1 + aStar) + Math.cbrt(Math.max(1 - aStar, 0)));
  const z2 = Math.sqrt(3 * aa + z1 * z1);
  const term = Math.max((3 - z1) * (3 + z1 + 2 * z2), 0);
  const rM = 3 + z2 - Math.sqrt(term);
  return Math.max(rM * M, horizonR(aStar) + 0.08);
}

const state = {
  quality: 'high',
  resolutionScale: QUALITY.high.scale,
  targetScale: QUALITY.high.scale,
  steps: QUALITY.high.steps,
  elevation: 0.34,
  azimuth: 0.7,
  distance: 15.5,
  fov: 0.74,
  spin: 0.75,
  diskBrightness: 1.55,
  exposure: 1.15,
  glow: 1.0,
  starDensity: 1.0,
  autoRotate: true,
  dragging: false,
  lastX: 0,
  lastY: 0,
  fps: 60,
  frames: 0,
  fpsTime: performance.now(),
  adaptTimer: 0,
};

const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x030308, 1);
if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} else if (THREE.sRGBEncoding !== undefined && 'outputEncoding' in renderer) {
  renderer.outputEncoding = THREE.sRGBEncoding;
}

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uCamRight: { value: new THREE.Vector3(1, 0, 0) },
  uCamUp: { value: new THREE.Vector3(0, 1, 0) },
  uCamForward: { value: new THREE.Vector3(0, 0, -1) },
  uFov: { value: state.fov },
  uSpin: { value: state.spin },
  uDiskBrightness: { value: state.diskBrightness },
  uExposure: { value: state.exposure },
  uSteps: { value: state.steps },
  uGlow: { value: state.glow },
  uStarDensity: { value: state.starDensity },
};

const material = new THREE.ShaderMaterial({
  vertexShader: blackholeVertexShader,
  fragmentShader: blackholeFragmentShader,
  uniforms,
  depthTest: false,
  depthWrite: false,
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

const elFps = document.getElementById('fps');
const elRes = document.getElementById('res');
const elQuality = document.getElementById('quality');
const elBri = document.getElementById('bri');
const elBriVal = document.getElementById('bri-val');
const elExp = document.getElementById('exp');
const elExpVal = document.getElementById('exp-val');
const elGlow = document.getElementById('glow');
const elGlowVal = document.getElementById('glow-val');
const elSpin = document.getElementById('spin');
const elSpinVal = document.getElementById('spin-val');
const elMeta = document.getElementById('kerr-meta');

function refreshMeta() {
  const a = state.spin;
  const rh = horizonR(a);
  const ri = iscoR(a);
  if (elSpinVal) elSpinVal.textContent = a.toFixed(2);
  if (elMeta) {
    elMeta.innerHTML =
      `Kerr · a = <b>${a.toFixed(2)}</b> M<br />` +
      `r<sub>+</sub> = ${rh.toFixed(3)} r<sub>s</sub> · ` +
      `r<sub>ISCO</sub> = ${ri.toFixed(3)} r<sub>s</sub>`;
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rw = Math.max(2, Math.floor(w * dpr * state.resolutionScale));
  const rh = Math.max(2, Math.floor(h * dpr * state.resolutionScale));
  renderer.setSize(rw, rh, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  uniforms.uResolution.value.set(rw, rh);
  elRes.textContent = `${rw}×${rh}`;
}

function updateCamera() {
  const el = state.elevation;
  const az = state.azimuth;
  const dist = state.distance;
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const pos = new THREE.Vector3(dist * ce * ca, dist * se, dist * ce * sa);
  const forward = pos.clone().multiplyScalar(-1).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  uniforms.uCamPos.value.copy(pos);
  uniforms.uCamForward.value.copy(forward);
  uniforms.uCamRight.value.copy(right);
  uniforms.uCamUp.value.copy(up);
  uniforms.uFov.value = state.fov;
}

function applyQuality(name) {
  const q = QUALITY[name];
  if (!q) return;
  state.quality = name;
  state.steps = q.steps;
  state.targetScale = q.scale;
  uniforms.uSteps.value = q.steps;
  if (elQuality) elQuality.textContent = name;
  document.querySelectorAll('.quality-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === name);
  });
}

function onPointerDown(e) {
  state.dragging = true;
  state.autoRotate = false;
  state.lastX = e.clientX;
  state.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!state.dragging) return;
  const dx = e.clientX - state.lastX;
  const dy = e.clientY - state.lastY;
  state.lastX = e.clientX;
  state.lastY = e.clientY;
  state.azimuth += dx * 0.005;
  state.elevation = THREE.MathUtils.clamp(state.elevation + dy * 0.004, 0.06, 1.2);
}

function onPointerUp(e) {
  state.dragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
}

function onWheel(e) {
  e.preventDefault();
  const factor = Math.exp(e.deltaY * 0.0012);
  state.distance = THREE.MathUtils.clamp(state.distance * factor, 5.5, 36);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('wheel', onWheel, { passive: false });

document.querySelectorAll('.quality-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyQuality(btn.dataset.quality));
});

if (elBri) {
  elBri.addEventListener('input', () => {
    state.diskBrightness = parseFloat(elBri.value);
    elBriVal.textContent = state.diskBrightness.toFixed(2);
    uniforms.uDiskBrightness.value = state.diskBrightness;
  });
}

if (elExp) {
  elExp.addEventListener('input', () => {
    state.exposure = parseFloat(elExp.value);
    elExpVal.textContent = state.exposure.toFixed(2);
    uniforms.uExposure.value = state.exposure;
  });
}

if (elGlow) {
  elGlow.addEventListener('input', () => {
    state.glow = parseFloat(elGlow.value);
    elGlowVal.textContent = state.glow.toFixed(2);
    uniforms.uGlow.value = state.glow;
  });
}

if (elSpin) {
  elSpin.addEventListener('input', () => {
    state.spin = parseFloat(elSpin.value);
    uniforms.uSpin.value = state.spin;
    refreshMeta();
  });
}

const btnDefault = document.getElementById('btn-default');
if (btnDefault) {
  btnDefault.addEventListener('click', () => {
    state.elevation = 0.34;
    state.azimuth = 0.7;
    state.distance = 15.5;
    state.spin = 0.75;
    state.diskBrightness = 1.55;
    state.exposure = 1.15;
    state.glow = 1.0;
    state.autoRotate = true;
    if (elSpin) elSpin.value = String(state.spin);
    if (elBri) elBri.value = String(state.diskBrightness);
    if (elExp) elExp.value = String(state.exposure);
    if (elGlow) elGlow.value = String(state.glow);
    if (elBriVal) elBriVal.textContent = state.diskBrightness.toFixed(2);
    if (elExpVal) elExpVal.textContent = state.exposure.toFixed(2);
    if (elGlowVal) elGlowVal.textContent = state.glow.toFixed(2);
    uniforms.uSpin.value = state.spin;
    uniforms.uDiskBrightness.value = state.diskBrightness;
    uniforms.uExposure.value = state.exposure;
    uniforms.uGlow.value = state.glow;
    refreshMeta();
    applyQuality('high');
  });
}

function adaptResolution(dt) {
  state.adaptTimer += dt;
  if (state.adaptTimer < 0.4) return;
  state.adaptTimer = 0;
  const fps = state.fps;
  const preset = QUALITY[state.quality].scale;
  // Kerr geodesics are heavier — keep a higher floor
  if (fps < 26) {
    state.targetScale = Math.max(0.45, state.targetScale - 0.05);
  } else if (fps > 45) {
    state.targetScale = Math.min(preset, state.targetScale + 0.04);
  }
  state.resolutionScale += (state.targetScale - state.resolutionScale) * 0.35;
  if (Math.abs(state.resolutionScale - state.targetScale) > 0.01) resize();
}

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  uniforms.uTime.value += dt;
  if (state.autoRotate && !state.dragging) state.azimuth += dt * 0.045;
  updateCamera();
  adaptResolution(dt);
  renderer.render(scene, camera);

  state.frames += 1;
  const now = performance.now();
  const elapsed = now - state.fpsTime;
  if (elapsed >= 500) {
    state.fps = (state.frames * 1000) / elapsed;
    state.frames = 0;
    state.fpsTime = now;
    if (elFps) elFps.textContent = state.fps.toFixed(0);
  }
}

window.addEventListener('resize', resize);

const params = new URLSearchParams(window.location.search);
const initQuality = params.get('quality') || 'high';
const initAz = params.get('az');
const initEl = params.get('el');
const initDist = params.get('dist');
const initAuto = params.get('auto');
const initSpin = params.get('a');

if (QUALITY[initQuality]) applyQuality(initQuality);
if (initAz !== null) state.azimuth = parseFloat(initAz) || state.azimuth;
if (initEl !== null) state.elevation = parseFloat(initEl) || state.elevation;
if (initDist !== null) state.distance = parseFloat(initDist) || state.distance;
if (initAuto === '0') state.autoRotate = false;
if (initSpin !== null && !Number.isNaN(parseFloat(initSpin))) {
  state.spin = THREE.MathUtils.clamp(parseFloat(initSpin), 0, 0.998);
  uniforms.uSpin.value = state.spin;
  if (elSpin) elSpin.value = String(state.spin);
}

if (params.get('static') === '1') {
  state.resolutionScale = QUALITY[state.quality].scale;
  state.targetScale = state.resolutionScale;
}

refreshMeta();
resize();
updateCamera();
frame();
