// WebGPU resource ownership lives here; physical mechanisms live in Slang cases.
export class WebGPURenderer {
  static async create(canvas, onError) {
    if (!globalThis.isSecureContext || !navigator.gpu) throw new Error('WebGPU 不可用：请通过 localhost/HTTPS 使用支持 WebGPU 的浏览器并启用硬件加速。');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到 WebGPU adapter。请检查浏览器的 GPU 支持。');
    const device = await adapter.requestDevice();
    const renderer = new WebGPURenderer(canvas, device, adapter.info, onError);
    try { await renderer.initialize(); return renderer; }
    catch (error) { renderer.destroy(); throw error; }
  }

  constructor(canvas, device, adapterInfo, onError) {
    this.canvas = canvas;
    this.device = device;
    this.adapterInfo = adapterInfo;
    this.onError = onError;
    this.disposed = false;
    device.addEventListener('uncapturederror', event => onError(event.error));
    device.lost.then(info => { if (!this.disposed) onError(new Error(`WebGPU device lost: ${info.message}`)); });
  }

  async initialize() {
    const d = this.device;
    const modules = await Promise.all(['flatMain', 'vertexMain', 'fragmentMain'].map(async name => {
      const response = await fetch(new URL(`../../shaders/generated/${name}.wgsl`, import.meta.url));
      if (!response.ok) throw new Error(`Missing ${name}.wgsl; run npm run build`);
      const module = d.createShaderModule({ label: name, code: await response.text() });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(errors.map(m => `${name}:${m.lineNum}: ${m.message}`).join('\n'));
      return module;
    }));
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('Cannot create WebGPU canvas context');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
    this.compute = await d.createComputePipelineAsync({ label: 'Case 1 / flat rays', layout: 'auto', compute: { module: modules[0], entryPoint: 'flatMain' } });
    const displayLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
    this.present = await d.createRenderPipelineAsync({ label: 'HDR display', layout: d.createPipelineLayout({ bindGroupLayouts: [displayLayout] }),
      vertex: { module: modules[1], entryPoint: 'vertexMain' },
      fragment: { module: modules[2], entryPoint: 'fragmentMain', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
    this.frame = d.createBuffer({ label: 'Camera ABI / 80 bytes', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.display = d.createBuffer({ label: 'Display ABI / 16 bytes', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  resize(width, height) {
    const d = this.device;
    width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
    const factor = Math.min(1, d.limits.maxTextureDimension2D/width, d.limits.maxTextureDimension2D/height,
      Math.sqrt(Math.min(d.limits.maxStorageBufferBindingSize, d.limits.maxBufferSize)/(width*height*16)));
    width = Math.max(1, Math.floor(width*factor)); height = Math.max(1, Math.floor(height*factor));
    if (this.width === width && this.height === height) return;
    this.hdr?.destroy(); this.rays?.destroy();
    this.width = this.canvas.width = width; this.height = this.canvas.height = height;
    this.hdr = d.createTexture({ label: 'Scene-linear HDR', size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.rays = d.createBuffer({ label: 'Ray directions + status', size: width*height*16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.computeGroup = d.createBindGroup({ layout: this.compute.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.frame } }, { binding: 1, resource: this.hdr.createView() }, { binding: 2, resource: { buffer: this.rays } },
    ] });
    this.presentGroup = d.createBindGroup({ layout: this.present.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.hdr.createView() }, { binding: 1, resource: { buffer: this.display } },
    ] });
  }

  render(camera, { exposure = 1, debug = false } = {}) {
    if (this.disposed) return;
    const d = this.device;
    d.queue.writeBuffer(this.frame, 0, new Float32Array([
      ...camera.position, 0, ...camera.forward, 0, ...camera.right, 0, ...camera.up, 0,
      this.width, this.height, Math.tan(camera.fov/2), debug ? 1 : 0,
    ]));
    d.queue.writeBuffer(this.display, 0, new Float32Array([exposure, debug ? 1 : 0, 0, 0]));
    const encoder = d.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.compute); compute.setBindGroup(0, this.computeGroup);
    compute.dispatchWorkgroups(Math.ceil(this.width/8), Math.ceil(this.height/8)); compute.end();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.present); pass.setBindGroup(0, this.presentGroup); pass.draw(3); pass.end();
    d.queue.submit([encoder.finish()]);
  }

  async readDirections() {
    const size = this.width*this.height*16;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.rays, 0, staging, 0, size);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const copy = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap(); return copy;
    } finally { staging.destroy(); }
  }

  destroy() {
    this.disposed = true;
    this.hdr?.destroy(); this.rays?.destroy(); this.frame?.destroy(); this.display?.destroy();
    this.context?.unconfigure(); this.device.destroy();
  }
}
