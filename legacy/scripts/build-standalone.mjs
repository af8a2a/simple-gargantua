import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const threeUmd = readFileSync(join(root, 'lib', 'three.min.js'), 'utf8');
const threeModule = readFileSync(join(root, 'lib', 'three.module.js'), 'utf8');
const shaders = await import(pathToFileURL(join(root, 'js', 'shaders.js')).href);
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');

const appBody = mainSrc
  .replace(/^import\s+\*\s+as\s+THREE\s+from\s+['"][^'"]+['"];?\s*$/m, '')
  .replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]*shaders\.js['"];?\s*$/m, '')
  .trim();

// Classic-script boot: works on file:// and http:// in Edge/Chrome.
// Priority: sibling UMD → inlined UMD → ES module blob.
const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gargantua — Kerr 黑洞</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='10' fill='%23000'/><circle cx='16' cy='16' r='12' fill='none' stroke='%23ffb04a' stroke-width='2'/></svg>" />
    <style>
${css}
#boot-error {
  display: none;
  position: fixed;
  z-index: 20;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: min(560px, calc(100vw - 48px));
  background: rgba(20, 8, 8, 0.92);
  border: 1px solid rgba(255, 120, 100, 0.55);
  color: #ffd2c8;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  padding: 16px 18px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
#boot-status {
  position: fixed;
  z-index: 15;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(142, 202, 230, 0.75);
  pointer-events: none;
}
#boot-status.hidden,
#boot-error.hidden { display: none !important; }
    </style>
  </head>
  <body>
    <canvas id="viewport"></canvas>
    <div id="boot-status">INITIALIZING WEBGL…</div>
    <div id="boot-error" class="hidden"></div>

    <div class="hud hud-title panel">
      <h1>GARGANTUA</h1>
      <p id="kerr-meta">
        Kerr 时空测地线 · 薄吸积盘黑体辐射<br />
        参考系拖曳 + 多普勒束 + 引力红移 + 光子环
      </p>
      <span class="tag">KERR · REAL-TIME · THREE.JS</span>
    </div>

    <div class="hud hud-help panel">
      <div><strong>拖拽</strong> 轨道相机</div>
      <div><strong>滚轮</strong> 推近 / 拉远</div>
      <div><strong>自旋 a</strong> 视界 / ISCO / 阴影不对称</div>
    </div>

    <div class="hud hud-controls panel">
      <h2>PARAMETERS</h2>
      <div class="control">
        <label>自旋 a / M <span id="spin-val">0.75</span></label>
        <input id="spin" type="range" min="0" max="0.99" step="0.01" value="0.75" />
      </div>
      <div class="control">
        <label>盘亮度 <span id="bri-val">1.55</span></label>
        <input id="bri" type="range" min="0.3" max="2.5" step="0.05" value="1.55" />
      </div>
      <div class="control">
        <label>曝光 <span id="exp-val">1.15</span></label>
        <input id="exp" type="range" min="0.4" max="3.0" step="0.05" value="1.15" />
      </div>
      <div class="control">
        <label>光子环辉光 <span id="glow-val">1.00</span></label>
        <input id="glow" type="range" min="0" max="2.5" step="0.05" value="1.0" />
      </div>
      <div class="control">
        <label>画质 · <span id="quality">high</span></label>
        <div class="quality-row">
          <button class="quality-btn" data-quality="low" type="button">LOW</button>
          <button class="quality-btn" data-quality="medium" type="button">MED</button>
          <button class="quality-btn active" data-quality="high" type="button">HIGH</button>
          <button class="quality-btn" data-quality="ultra" type="button">ULTRA</button>
        </div>
      </div>
      <button id="btn-default" class="btn-reset" type="button">RESET VIEW</button>
    </div>

    <div class="hud hud-status panel">
      <span>FPS <span class="val" id="fps">--</span></span>
      <span class="sep">/</span>
      <span>RES <span class="val" id="res">--</span></span>
    </div>

    <!-- sibling UMD (works over file:// when lib/ exists) -->
    <script src="./lib/three.min.js"></script>

    <script>
(function () {
  var bootStatus = document.getElementById('boot-status');
  var bootError = document.getElementById('boot-error');

  function showBootError(err) {
    var msg = err && err.stack ? err.stack : String(err);
    console.error(err);
    bootError.textContent = '启动失败\\n' + msg;
    bootError.classList.remove('hidden');
    bootStatus.classList.add('hidden');
  }

  function hideBootStatus() {
    bootStatus.classList.add('hidden');
  }

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  }

  function loadUmdFromText(src) {
    // Evaluate UMD bundle in global scope → window.THREE
    var global = (0, eval);
    global(src);
    return window.THREE || self.THREE || global.THREE;
  }

  function loadTHREE() {
    return new Promise(function (resolve, reject) {
      if (window.THREE && window.THREE.WebGLRenderer) {
        console.info('[Gargantua] three.js via sibling UMD');
        resolve(window.THREE);
        return;
      }

      try {
        var inlined = ${JSON.stringify(threeUmd)};
        var mod = loadUmdFromText(inlined);
        if (mod && mod.WebGLRenderer) {
          console.info('[Gargantua] three.js via inlined UMD');
          resolve(mod);
          return;
        }
      } catch (e) {
        console.warn('[Gargantua] inlined UMD failed', e);
      }

      // Last resort: ES module (needs http(s) or blob-capable context)
      try {
        var modSrc = ${JSON.stringify(threeModule)};
        var url = URL.createObjectURL(new Blob([modSrc], { type: 'text/javascript' }));
        import(url)
          .then(function (mod) {
            var api = mod.WebGLRenderer ? mod : mod.default;
            console.info('[Gargantua] three.js via ES module blob');
            resolve(api);
          })
          .catch(reject)
          .finally(function () { URL.revokeObjectURL(url); });
        return;
      } catch (e) {
        reject(e);
      }
    });
  }

  function bootApp(THREE) {
    var blackholeVertexShader = ${JSON.stringify(shaders.blackholeVertexShader)};
    var blackholeFragmentShader = ${JSON.stringify(shaders.blackholeFragmentShader)};

${appBody}

    hideBootStatus();
  }

  function start() {
    if (!window.WebGLRenderingContext || !hasWebGL()) {
      showBootError(new Error(
        '当前环境无法创建 WebGL 上下文。\\n' +
        '请在 Edge 开启硬件加速（设置 → 系统和性能），或用 Chrome 打开。\\n' +
        '若从资源管理器双击打开，请改访问：http://127.0.0.1:8765/'
      ));
      return;
    }

    // If sibling script is still loading, wait briefly
    if (!window.THREE) {
      var waited = 0;
      var timer = setInterval(function () {
        waited += 50;
        if (window.THREE || waited > 800) {
          clearInterval(timer);
          loadTHREE().then(bootApp).catch(showBootError);
        }
      }, 50);
      return;
    }

    loadTHREE().then(bootApp).catch(showBootError);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
    </script>
  </body>
</html>
`;

const out = join(root, 'index.html');
writeFileSync(out, html, 'utf8');
console.log('Wrote classic+standalone index.html', (html.length / 1024 / 1024).toFixed(2), 'MB');
