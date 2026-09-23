# Gargantua · Reference Cases

项目正在从一次性的 three.js / GLSL 效果迁移为 **WebGPU + Slang** 渲染器。长期物理路线以 [talk.md](talk.md) 为准：每个 Case 只引入一个主要机制，旧 Case 长期保留为 A/B 对照。

当前实现 **Case 0：CPU FP64 Schwarzschild Reference Integrator**，以及用于验收新渲染管线的 **Case 1：Flat Space / UV Grid**。Case 2–11 尚未实现，界面明确禁用。旧 Kerr 效果完整保留在 `legacy/`，可打开 `/legacy/index.html`；它不属于新物理基准，也没有被移植到新 Shader 中。

## 运行

需要 Node.js 20+；GPU 场景需要支持 WebGPU 的浏览器与硬件加速，通过 localhost 或 HTTPS 访问。

```sh
npm ci
npm run serve
# http://127.0.0.1:8765/           Case 1：WebGPU UV grid
# http://127.0.0.1:8765/?case=0    Case 0：纯 CPU，无需 WebGPU
```

生成的 WGSL 已入库，普通运行无需安装 Slang。新入口采用 ES Modules，不再支持双击 file:// 启动。拖拽旋转相机，滚轮调整 FOV；Case 1 提供方向 RGB、HDR 曝光、CPU/GPU 相机方向对照。Case 0 可运行固定光线并下载 JSON。

## 构建和验证

Shader 的唯一维护源是 `shaders/*.slang`，`shaders/generated/` 由 **Slang 2026.8** 编译验证。安装 [Slang](https://shader-slang.org/docs/) 并将 `slangc` 加入 PATH，或设置 `SLANGC` 为可执行文件的完整路径。

```sh
npm run build                  # Slang → WGSL；编译失败立即终止
npm run build:check            # 校验源码和生成文件 SHA-256，无需编译器
npm test                       # 纯 CPU：物理、相机、Case 契约
npm run reference              # output/reference/case-00.json
npm run verify:webgpu -- --edge # 无头 Edge：真实 WebGPU 数值读回及 UI
npm run verify                 # 构建一致性 + CPU + WebGPU（Windows 默认 Edge）
```

Windows 默认使用已安装的 Edge，其他平台使用 Playwright Chromium。可用 `--edge` / `--chromium` 显式选择；Chromium 缺少浏览器文件时执行 `npx playwright install chromium`。本机实测 Edge 可使用 NVIDIA Blackwell adapter；当前 Playwright Chromium 默认配置未取得 adapter，会明确失败，不会自动跳过。`--software` 显式启用 SwiftShader，不能据此声称硬件性能达标。测试不会控制主桌面。输出报告和截图在 `output/verification/`。GitHub Actions 只运行生成文件一致性与 CPU 数值验收并归档 reference JSON；GPU 验收单独在支持 WebGPU 的设备上执行。

旧物理测试保留为 `legacy:verify:integrator`、`legacy:verify:redshift`、`legacy:verify:ring`、`legacy:verify:termination`、`legacy:verify:absorption`；`legacy:build` 只生成旧入口。

## 结构

```text
talk.md                    长期 roadmap 与已落地进度
src/core/                  FP64 相机、向量与坐标约定
src/reference/             独立 CPU FP64 DOPRI 5(4)、固定光线、Web Worker
src/cases/registry.js       Case 状态、previousId、物理 referenceId
src/render/                WebGPU 设备、计算/显示 Pass、资源生命周期、读回
shaders/                   Slang 相机、Case 1 和显示 Shader
shaders/generated/         WGSL + 编译器版本和 SHA-256 manifest
tests/                     解析解、独立求积、守恒量、收敛与几何事件
scripts/                   构建、静态服务、reference 导出、GPU 验证
legacy/                    原始 three.js / Kerr 示例、依赖和测试
```

## 数值基准

新主线统一 `G=c=M=1`：视界 `r=2`、光子球 `r=3`、临界 impact parameter `b=3√3`。旧版使用 `2M=1`，其数值不能直接作为新基准。

积分器用 JavaScript `Number`（IEEE-754 binary64）在 CPU 上运行，默认 `rtol=1e-13 / atol=1e-14`。采用球对称下的**精确轨道平面约化**，并非伪牛顿弯曲；使用自适应 Dormand–Prince 5(4)，对视界截断面、逃逸面、最近点和盘交点进行子步重积分定位。详细方程、时间/动量约定和误差边界见 [reference-contract.md](docs/reference-contract.md)。

输出包含初始光线、`escaped/captured/unresolved`、有限逃逸面的方向、最近半径、盘面交点、Schwarzschild 坐标传播时间、绕行数、四位置/协变四动量、步数和 null 残差。预算耗尽不能当作 capture 或 escape。Case 0 的盘交点只是几何探针，不包含盘辐射。

测试包括 `b=5.0/5.19/5.20/6.0`、临界两侧与多绕行光线，另用解析径向传播时间、精确圆形光子轨道、独立一阶积分求积、弱场 `4M/b`、容差收敛、旋转协变性与盘事件验证结果。**局部容差不是全局误差保证**：尤其近临界区域必须对同一光线收紧容差再比较。

## 新渲染管线与后续扩展

`Slang compute → rgba32float scene-linear HDR + ray diagnostics → exposure → tone mapping → sRGB presentation`。显示转换仅做一次。HDR 中间缓冲并不等同于已实现 HDR 显示器输出。

新 Case 应独立实现机制，复用相机、资源管理和显示 Pass；相同分辨率、相机、采样、时间和曝光用于 A/B，比较原始物理量而非后处理截图。Case 0 是全局数值 oracle；Case 1 通过 CPU 直线解析相机验证 GPU；Case 2 开始才加入 GPU 测地线并与 Case 0 比较。Case 8 的 Kerr sky 还必须与 Case 2 在 `a→0` 时对照，不能用含复杂盘的前一阶段掩盖几何差异。

采用 [Slang 官方 WGSL 后端](https://shader-slang.org/slang/user-guide/wgsl-target-specific)，使用显式绑定与独立写入纹理。当前不依赖可选 GPU 扩展，不宣称 WebGPU 具备硬件光追或 GPU FP64。后续能力应先查询设备支持并保留明确的验证路径。
