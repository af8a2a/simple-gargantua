import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blackholeFragmentShader as fragment, blackholeVertexShader as vertex } from '../js/shaders.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const embedded=readFileSync(join(root,'index.html'),'utf8').match(/var blackholeFragmentShader = ("[^\n]*");/);
assert.ok(embedded,'Standalone shader must be present');
assert.equal(JSON.parse(embedded[1]),fragment,'Run npm run build to synchronize index.html');
const browser=await chromium.launch({headless:true,channel:process.argv.includes('--edge')?'msedge':undefined,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
try {
 const page=await browser.newPage(),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<canvas id="test"></canvas>');
 await page.addScriptTag({path:join(root,'lib/three.min.js')});
 const result=await page.evaluate(({fragment,vertex})=>{
  const width=41,height=25;
  const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('test')});renderer.setSize(width,height);
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('Float render targets required');
  const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});
  const uniforms={uResolution:{value:new THREE.Vector2(width,height)},uTime:{value:0},uFov:{value:0.74},
   uCamPos:{value:new THREE.Vector3()},uCamRight:{value:new THREE.Vector3()},uCamUp:{value:new THREE.Vector3()},uCamForward:{value:new THREE.Vector3()},
   uSpin:{value:0},uSteps:{value:110},uDiskBrightness:{value:0},uGlow:{value:0},uExposure:{value:1},uStarDensity:{value:0},
   uCasePos:{value:new THREE.Vector3()},uCaseMomentum:{value:new THREE.Vector4()}};
  const materials=[];
  const make=source=>{const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:source,uniforms,depthTest:false,depthWrite:false});materials.push(material);return material;};
  const diagnostic=source=>{
   const marker=source.indexOf('  // Keep accumulated foreground emission');
   if(marker<0)throw new Error('Background composition marker not found');
   return source.slice(0,marker)+'\n gl_FragColor=vec4(float(rayStatus),ksRadius(x,aDim),length(escapeDirKs),1.0);\n}';
  };
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry);
  scene.add(quad);
  const render=material=>{quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);const out=new Float32Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,out);return out;};
  const production=make(fragment),states=make(diagnostic(fragment));
  const setCamera=(distance,outward=false)=>{
   const pos=uniforms.uCamPos.value,forward=uniforms.uCamForward.value,right=uniforms.uCamRight.value,up=uniforms.uCamUp.value;
   if(outward)pos.set(distance,0,0);else pos.set(distance*Math.cos(0.34)*Math.cos(0.7),distance*Math.sin(0.34),distance*Math.cos(0.34)*Math.sin(0.7));
   forward.copy(pos).multiplyScalar(outward?1:-1).normalize();right.crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();up.crossVectors(right,forward).normalize();
  };
  const cases=[];
  for(const spin of [0,0.75,0.998])for(const distance of [5.5,15.5,36])for(const steps of [0,110,320]) {
   setCamera(distance);uniforms.uSpin.value=spin;uniforms.uSteps.value=steps;
   const state=render(states);uniforms.uStarDensity.value=0;const dark=render(production);uniforms.uStarDensity.value=1;const stars=render(production);
   const counts=[0,0,0,0];let maxNonEscapeDifference=0,escapedWithStars=0;
   for(let i=0;i<state.length;i+=4){
    const status=state[i];if(!Number.isInteger(status)||status<0||status>3)throw new Error('Invalid ray status');counts[status]++;
    let difference=0;
    for(let c=0;c<3;c++){if(!Number.isFinite(dark[i+c])||!Number.isFinite(stars[i+c]))throw new Error('Nonfinite color');difference=Math.max(difference,Math.abs(stars[i+c]-dark[i+c]));}
    if(status===2){if(difference>1e-7)escapedWithStars++;}else maxNonEscapeDifference=Math.max(maxNonEscapeDifference,difference);
   }
   cases.push({spin,distance,steps,counts,maxNonEscapeDifference,escapedWithStars});
  }
  // Unit classification checks include incoming rays outside both the far
  // boundary and the former |x|=50 safety cutoff; neither proves escape.
  const functions=fragment.slice(0,fragment.lastIndexOf('void main()'));
  const classifier=make(functions+`\nuniform vec3 uCasePos; uniform vec4 uCaseMomentum;
void main(){vec3 direction;int status=classifyRay(uCasePos,uCaseMomentum,0.0,1.0,40.0,direction);gl_FragColor=vec4(float(status),direction);}`);
  const classifierCases=[
   {name:'outside outgoing',pos:[41,0,0],p:[1,1,0,0],expected:2},
   {name:'outside incoming',pos:[41,0,0],p:[40/42,-1,0,0],expected:0},
   {name:'beyond former safety cutoff incoming',pos:[60,0,0],p:[59/61,-1,0,0],expected:0},
   {name:'captured',pos:[0.9,0,0],p:[1,1,0,0],expected:1},
   {name:'NaN position',pos:[NaN,0,0],p:[1,1,0,0],expected:3},
   {name:'infinite position',pos:[Infinity,0,0],p:[1,1,0,0],expected:3},
   {name:'NaN momentum',pos:[41,0,0],p:[NaN,1,0,0],expected:3},
   {name:'infinite momentum',pos:[41,0,0],p:[Infinity,1,0,0],expected:3},
   {name:'zero tangent',pos:[41,0,0],p:[0,0,0,0],expected:3},
  ];
  const classified=classifierCases.map(c=>{uniforms.uCasePos.value.fromArray(c.pos);uniforms.uCaseMomentum.value.fromArray(c.p);const actual=render(classifier);return {name:c.name,expected:c.expected,status:actual[0],direction:Array.from(actual.slice(1,4))};});
  // An outward Schwarzschild ray at r=36 advances exactly 0.55 per step:
  // step 8 reaches r=40.4, first crossing escapeR=40 on its final step.
  setCamera(36,true);uniforms.uSpin.value=0;uniforms.uSteps.value=8;
  const center=4*(Math.floor(height/2)*width+Math.floor(width/2));
  const lastBudget=Array.from(render(states).slice(center,center+4));
  const hardLimit=make(diagnostic(fragment.replace('const int MAX_STEPS = 640;','const int MAX_STEPS = 8;')));
  const lastHardLimit=Array.from(render(hardLimit).slice(center,center+4));
  // Inject an invalid integration result while leaving camera/sky data valid.
  // It must stop before radiative sampling and must not see background light.
  const faulty=fragment.replace('    hamStep(x, pk, aDim, dlam);','    hamStep(x, pk, aDim, dlam);\n    pk.x = uTime;');
  uniforms.uTime.value=NaN;uniforms.uSteps.value=1;setCamera(15.5);
  const faultState=render(make(diagnostic(faulty)));uniforms.uStarDensity.value=0;const faultDark=render(make(faulty));uniforms.uStarDensity.value=1;const faultStars=render(make(faulty));
  let invalidPixels=0,maxFaultDifference=0;
  for(let i=0;i<faultState.length;i+=4){if(faultState[i]===3)invalidPixels++;for(let c=0;c<3;c++){if(!Number.isFinite(faultDark[i+c])||!Number.isFinite(faultStars[i+c]))throw new Error('Invalid ray contaminated color');maxFaultDifference=Math.max(maxFaultDifference,Math.abs(faultDark[i+c]-faultStars[i+c]));}}
  const glError=renderer.getContext().getError();materials.forEach(m=>m.dispose());target.dispose();geometry.dispose();renderer.dispose();
  return {pixels:width*height,cases,classified,lastBudget,lastHardLimit,invalidPixels,maxFaultDifference,glError};
 },{fragment,vertex});
 assert.deepEqual(errors,[],'Shaders must compile without errors');assert.equal(result.glError,0);
 for(const c of result.cases){
  const label=`spin=${c.spin}, distance=${c.distance}, steps=${c.steps}`;
  assert.equal(c.maxNonEscapeDifference,0,`${label}: unfinished/captured/invalid rays must not gain background`);
  if(c.steps===0)assert.equal(c.counts[0],result.pixels,`${label}: no steps must leave all rays unfinished`);
 }
 assert.ok(result.cases.some(c=>c.steps===110&&c.distance===36&&c.counts[0]>0),'LOW at far distance must exercise budget exhaustion');
 assert.ok(result.cases.some(c=>c.counts[1]>0),'Captured rays must be covered');
 assert.ok(result.cases.some(c=>c.escapedWithStars>0),'Confirmed escape must still render stars');
 for(const c of result.classified){assert.equal(c.status,c.expected,c.name);assert.ok(c.direction.every(Number.isFinite),`${c.name}: finite escape direction`);}
 for(const endpoint of [result.lastBudget,result.lastHardLimit]){assert.equal(endpoint[0],2,'Final step must be classified as escaped');assert.ok(Math.abs(endpoint[1]-40.4)<1e-4,'Radial final position');assert.ok(Math.abs(endpoint[2]-1)<1e-6,'Escape direction must be normalized');}
 assert.equal(result.invalidPixels,result.pixels,'All injected invalid rays must be recognized');assert.equal(result.maxFaultDifference,0,'Invalid rays must not receive sky');
 console.log(JSON.stringify({cases:result.cases.length,pixelsPerCase:result.pixels,
  farLow:result.cases.filter(c=>c.distance===36&&c.steps===110),classifierCases:result.classified.length,
  finalBudgetStatus:result.lastBudget[0],finalHardLimitStatus:result.lastHardLimit[0],invalidPixels:result.invalidPixels},null,2));
 console.log('PASS: only confirmed escape receives background; exhausted, captured and invalid rays do not');
}finally{await browser.close();}
