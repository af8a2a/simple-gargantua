import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blackholeFragmentShader as fragment, blackholeVertexShader as vertex } from '../js/shaders.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const embedded = readFileSync(join(root, 'index.html'), 'utf8').match(/var blackholeFragmentShader = ("[^\n]*");/);
assert.ok(embedded, 'Standalone shader must be present');
assert.equal(JSON.parse(embedded[1]), fragment, 'Run npm run build to synchronize index.html');
const browser = await chromium.launch({
  headless: true, channel: process.argv.includes('--edge') ? 'msedge' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<canvas id="test"></canvas>');
  await page.addScriptTag({ path: join(root, 'lib/three.min.js') });
  const result = await page.evaluate(({ fragment, vertex }) => {
    // Odd dimensions exercise the center pixel, where the polar angle is undefined.
    const width=127, height=95;
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('test') });
    renderer.setSize(width,height);
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Float render targets required');
    const target = new THREE.WebGLRenderTarget(width,height, {
      type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,
    });
    const uniforms = {
      uResolution:{value:new THREE.Vector2(width,height)},uTime:{value:0},
      uCamPos:{value:new THREE.Vector3()},uCamRight:{value:new THREE.Vector3()},
      uCamUp:{value:new THREE.Vector3()},uCamForward:{value:new THREE.Vector3()},
      uFov:{value:0.74},uSpin:{value:0},uExposure:{value:1.15},
      // Disable ray integration, disk and background to isolate the overlay.
      uSteps:{value:0},uDiskBrightness:{value:0},uStarDensity:{value:0},uGlow:{value:1},
    };
    const makeMaterial = fragmentShader => new THREE.ShaderMaterial({
      vertexShader:vertex,fragmentShader,uniforms,depthTest:false,depthWrite:false,
    });
    const overlay = makeMaterial(fragment);
    const marker = fragment.indexOf('  // Backtrace from the camera');
    if (marker < 0) throw new Error('Camera initialization marker not found');
    // Reuse the production main's sky calculation to check the refinement
    // bands as well as the visible glow. No copy of the coordinate formula.
    const bands = makeMaterial(fragment.slice(0,marker)+'\n gl_FragColor=vec4(bCrit,dbCrit,skyCrit,1.0);\n}');
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,overlay);
    scene.add(quad);
    const render = material => {
      quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixels=new Float32Array(width*height*4);
      renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
      return pixels;
    };
    const difference = (actual,expected) => {
      let maximum=0,sum=0;
      for(let i=0;i<actual.length;i++) {
        if(!Number.isFinite(actual[i]))throw new Error('Nonfinite shader output');
        const d=Math.abs(actual[i]-expected[i]);maximum=Math.max(maximum,d);sum+=d;
      }
      return {maximum,mean:sum/actual.length};
    };
    const checks=[];
    for(const spin of [0,0.75,0.998])for(const elevation of [0.06,0.34,1.2])for(const distance of [5.5,15.5,36]) {
      uniforms.uSpin.value=spin;
      let baseOverlay,baseBands;
      for(const azimuth of [0,0.7,Math.PI/2,Math.PI,4.5]) {
        const pos=uniforms.uCamPos.value,forward=uniforms.uCamForward.value;
        const right=uniforms.uCamRight.value,up=uniforms.uCamUp.value;
        pos.set(distance*Math.cos(elevation)*Math.cos(azimuth),distance*Math.sin(elevation),distance*Math.cos(elevation)*Math.sin(azimuth));
        forward.copy(pos).multiplyScalar(-1).normalize();
        right.crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
        up.crossVectors(right,forward).normalize();
        const glow=render(overlay),diagnostic=render(bands);
        // Validate even the reference image so a NaN or blank image cannot pass.
        difference(glow,glow);difference(diagnostic,diagnostic);
        if(azimuth===0) {
          baseOverlay=glow;baseBands=diagnostic;
          let energy=0;
          for(let i=0;i<glow.length;i+=4)energy+=glow[i]+glow[i+1]+glow[i+2];
          if(!(energy>1))throw new Error('Ring overlay must be visible');
        }
        const ringError=difference(glow,baseOverlay),bandError=difference(diagnostic,baseBands);
        let schwarzschildError=0;
        if(spin===0)for(let i=0;i<diagnostic.length;i+=4)schwarzschildError=Math.max(schwarzschildError,Math.abs(diagnostic[i]-3*Math.sqrt(3)*0.5));
        checks.push({spin,elevation,distance,azimuth,ringError,bandError,schwarzschildError});
      }
    }
    const glError=renderer.getContext().getError();
    overlay.dispose();bands.dispose();target.dispose();geometry.dispose();renderer.dispose();
    return {checks,glError};
  }, { fragment, vertex });
  assert.deepEqual(errors,[],'Shaders must compile without errors');
  assert.equal(result.glError,0,'No WebGL errors');
  for(const c of result.checks) {
    const label=`spin=${c.spin}, elevation=${c.elevation}, distance=${c.distance}, azimuth=${c.azimuth}`;
    assert.ok(c.ringError.maximum<1e-4,`${label}: ring changed with world azimuth (${c.ringError.maximum})`);
    assert.ok(c.bandError.maximum<1e-4,`${label}: critical bands changed with world azimuth (${c.bandError.maximum})`);
    assert.ok(c.schwarzschildError<1e-6,`${label}: Schwarzschild overlay radius must be 3*sqrt(3)*M`);
  }
  console.log(JSON.stringify({cases:result.checks.length,
    maxRingDifference:Math.max(...result.checks.map(c=>c.ringError.maximum)),
    maxBandDifference:Math.max(...result.checks.map(c=>c.bandError.maximum)),
    maxSchwarzschildRadiusError:Math.max(...result.checks.map(c=>c.schwarzschildError))},null,2));
  console.log('PASS: ring overlay and critical bands are invariant under camera rotations around the spin axis');
} finally {await browser.close();}
