import { orbitCamera, cameraRay } from './core/camera.js';
import { dot, angle } from './core/math.js';
import { CASES, getCase } from './cases/registry.js';
import { WebGPURenderer } from './render/webgpu-renderer.js';

const $ = id => document.getElementById(id);
const state = { caseId: 1, azimuth: 0, elevation: 0.2, fov: Math.PI/3, exposure: 1, debug: false };
let renderer, rendererPromise, report, worker, failed = false;
const showError = error => { failed = true; $('error').hidden = false; $('error').textContent = error.message; $('status').textContent = '运行失败 · 见错误信息'; };

for (const c of CASES) {
  const option = new Option(`${String(c.id).padStart(2, '0')} · ${c.name}${c.status === 'planned' ? ' · 待实现' : ''}`, c.id);
  option.disabled = c.status !== 'ready'; $('case-select').add(option);
}

function drawAxes(camera) {
  $('axis-labels').replaceChildren();
  if (state.caseId !== 1) return;
  const width = $('viewport').clientWidth, height = $('viewport').clientHeight, t = Math.tan(camera.fov/2);
  for (const [label, vector] of [['+X',[1,0,0]],['−X',[-1,0,0]],['+Y',[0,1,0]],['−Y',[0,-1,0]],['+Z',[0,0,1]],['−Z',[0,0,-1]]]) {
    const z = dot(vector, camera.forward);
    if (z <= 0) continue;
    const x = .5 + dot(vector, camera.right)/(z*t*width/height)*.5;
    const y = .5 - dot(vector, camera.up)/(z*t)*.5;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    const span = document.createElement('span'); span.textContent = label;
    span.style.left = `${x*100}%`; span.style.top = `${y*100}%`; $('axis-labels').append(span);
  }
}

function render() {
  if (!renderer || failed || state.caseId !== 1) return;
  const canvas = $('viewport');
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.resize(canvas.clientWidth*dpr, canvas.clientHeight*dpr);
  const camera = orbitCamera(state);
  renderer.render(camera, state); drawAxes(camera);
  $('status').textContent = `Case 01 · WebGPU / Slang · ${renderer.width} × ${renderer.height} · scene-linear HDR · G=c=M=1`;
}

function runReference() {
  if (worker) return;
  $('run-reference').disabled = true;
  $('status').textContent = 'Case 00 · CPU FP64 积分中…';
  worker = new Worker(new URL('./reference/worker.js', import.meta.url), { type: 'module' });
  const stop = () => { worker.terminate(); worker = null; $('run-reference').disabled = false; };
  worker.onerror = event => { stop(); showError(new Error(event.message)); };
  worker.onmessage = ({ data }) => {
    stop();
    if (data.error) { showError(new Error(data.error)); return; }
    report = data; $('download').disabled = false; $('reference-results').replaceChildren();
    for (const { id, result: r } of report.rays) {
      const tr = document.createElement('tr');
      for (const value of [id, r.status, r.closestApproach.toFixed(6), r.winding.toFixed(4), r.diagnostics.acceptedSteps, r.diagnostics.maxNullResidual.toExponential(2)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      tr.children[1].className = r.status; $('reference-results').append(tr);
    }
    const passed = report.rays.every(r => r.expected === r.result.status);
    if (state.caseId === 0) $('status').textContent = `Case 00 · ${report.rays.length} 条固定光线 · 分类${passed ? '通过' : '失败'} · 完整数值验证请运行 npm test`;
  };
  worker.postMessage({});
}

async function selectCase(id) {
  const c = getCase(id); state.caseId = id;
  $('case-select').value = String(id);
  $('case-description').textContent = c.mechanism;
  $('viewport').hidden = $('render-controls').hidden = $('axis-labels').hidden = id === 0;
  $('reference-panel').hidden = id !== 0;
  $('error').hidden = true;
  $('comparison').hidden = id === 0;
  if (failed && id === 1) { renderer?.destroy(); renderer = undefined; rendererPromise = undefined; failed = false; }
  const url = new URL(location.href); url.searchParams.set('case', String(id)); history.replaceState(null, '', url);
  if (id === 0) { runReference(); return; }
  if (!rendererPromise) rendererPromise = WebGPURenderer.create($('viewport'), showError);
  try { renderer = await rendererPromise; render(); }
  catch (error) { if (state.caseId === 1) showError(error); }
}

$('case-select').addEventListener('change', () => selectCase(Number($('case-select').value)).catch(showError));
$('run-reference').onclick = () => selectCase(0).catch(showError);
$('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'case-00-reference.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('debug').onchange = () => { state.debug = $('debug').value === 'direction'; render(); };
$('exposure').oninput = () => { state.exposure = Number($('exposure').value); $('exposure-value').value = state.exposure.toFixed(1); render(); };
$('reset').onclick = () => { Object.assign(state, { azimuth: 0, elevation: .2, fov: Math.PI/3 }); render(); };
$('compare').onclick = async () => {
  try {
    render();
    const width = renderer.width, height = renderer.height, camera = orbitCamera(state);
    const gpu = await renderer.readDirections();
    let max = 0;
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height/32))) for (let x = 0; x < width; x += Math.max(1, Math.floor(width/32))) {
      const i = 4*(y*width+x);
      const direction = Array.from(gpu.subarray(i,i+3));
      if (!direction.every(Number.isFinite) || Math.hypot(...direction) < .99 || gpu[i+3] !== 1) throw new Error('Invalid GPU ray data');
      max = Math.max(max, angle(cameraRay(camera, x, y, width, height), direction));
    }
    $('comparison').textContent = `相同相机 / 像素中心 · 最大方向误差 ${max.toExponential(3)} rad · ${max < 1e-6 ? 'PASS' : 'FAIL'}`;
  } catch (error) { showError(error); }
};
let pointer;
$('viewport').onpointerdown = event => { pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; $('viewport').setPointerCapture(event.pointerId); };
$('viewport').onpointermove = event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  state.azimuth -= (event.clientX-pointer.x)*.005;
  state.elevation = Math.max(-1.5, Math.min(1.5, state.elevation+(event.clientY-pointer.y)*.005));
  pointer.x = event.clientX; pointer.y = event.clientY; render();
};
$('viewport').onpointerup = $('viewport').onpointercancel = () => { pointer = null; };
$('viewport').addEventListener('wheel', event => { event.preventDefault(); state.fov = Math.max(.15, Math.min(2.5, state.fov+event.deltaY*.001)); render(); }, { passive: false });
new ResizeObserver(render).observe($('stage'));
window.addEventListener('pagehide', () => { worker?.terminate(); renderer?.destroy(); });

const requested = Number(new URLSearchParams(location.search).get('case') ?? 1);
selectCase(requested).catch(showError);
