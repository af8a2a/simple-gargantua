# 实施状态与长期约定（2026-09-23）

本文件作为项目长期 roadmap，以下记录当前已落地范围；后面的原始 Case ladder 保留作为物理目标说明。

| 范围 | 状态 | 当前产物 / 验收 |
|---|---|---|
| 渲染器基础 | 已实现 | WebGPU compute → scene-linear HDR → display；Slang 编译 WGSL、版本与 hash manifest、GPU 读回、资源释放与错误报告 |
| **0 Reference Integrator** | 已实现 | CPU FP64 DOPRI 5(4)，Schwarzschild 精确轨道平面约化；固定光线、解析解与独立求积、容差收敛、几何事件、JSON 导出 |
| **1 Flat Space** | 基础验收已实现 | 10° UV grid、六轴标记、右手相机、像素中心、HDR/曝光；CPU/GPU 方向 A/B |
| **2 Schwarzschild Sky** | 下一阶段 | 仅引入 GPU Schwarzschild 测地线与 capture；与 Case 1 保持相同相机/天空，并逐光线对照 Case 0 |
| 3–11 | 未实现 | 按下文逐级推进，未验收机制不开放为已完成 Case |
| 旧版 Kerr 效果 | 独立保留 | `legacy/`，不属于新参考链，继续可运行 |

实现入口与命令见 [README.md](README.md)，精确的单位、时间方向、四动量、有限逃逸面和误差边界见 [docs/reference-contract.md](docs/reference-contract.md)。Case 注册表为 `src/cases/registry.js`。

**长期规则：**

1. 新主线始终使用 `G=c=M=1`；旧版 `2M=1` 不可混用。
2. Case 0 是无渲染数值 oracle；Case 1 的相机先与 CPU 直线解析解对照。不得把二者称为相邻图像 A/B。
3. 每个新 Case 保留前级入口与固定输入。同画面 A/B 固定相机、分辨率、采样、时刻和曝光，仅改变新机制；任何预算耗尽都标为 `unresolved`。
4. `previousId` 记录顺序，`referenceId` 记录物理对照。Case 8 的几何比较还必须回到 Case 2 的无盘 Schwarzschild sky；Case 9 在 `a→0` 时还应回归前面的 Schwarzschild disk。
5. Slang 为 Shader 唯一维护源；不手改生成的 WGSL。Case 0 与 GPU 实现独立，不能因为 GPU 输出改变而自动更新验收预期。
6. 普通区域与临界区域分开记录误差及收敛。局部 RK 容差、null 残差均不能单独替代全局方向误差；有限边界的方向和时间不能标作无穷远结果。
7. 未验收前不接入噪声、艺术光子环、Bloom 等可能掩盖物理错误的效果。当前 HDR 指线性浮点中间缓冲，不代表已实现 HDR 显示器输出。

当前验证命令：`npm test`、`npm run build:check`、`npm run verify:webgpu -- --edge`、`npm run reference`。Case 2 的门槛是完成分类/方向/最小半径/传播时间/步数 diagnostics，对固定光线和像素样本与 Case 0 做定量比较，而不只是画出黑洞。

> 下文保留的 `:chatgpt-content-reference{...}` 是原始讨论的引用占位符，不是可访问的参考来源。后续采用具体算法时必须补全并核实论文/实现链接；已实现接口的来源链接记录在 reference-contract 中。

---

我会把开发过程设计成一套 **逐级 Reference Cases**，而不是简单地按“先黑洞→再吸积盘→再加 Bloom”推进。关键原则是：**每个 Case 只新增一个主要物理机制，而且前一个 Case 可以作为后一个 Case 的 A/B reference。**

Bruneton 的实时 Schwarzschild 实现本身就很适合前半段：它把非旋转黑洞的偏折和吸积盘交点预计算成表，运行时常数时间查询，同时专门处理恒星等高频光源的过滤。:chatgpt-content-reference{index="0"} Kerr 阶段则可以转向 GRay2/Odyssey 这类 GPU 测地线积分方案；GRay2 特别使用 Cartesian Kerr–Schild 坐标避免常见坐标奇点，并提供了收敛验证。:chatgpt-content-reference{index="1"}



---

## 我建议的完整 Case ladder

| Case | 场景 | 这一阶段只加入 | 主要验证目标 |
|---|---|---|---|
| **0 Reference Integrator** | 无渲染 | CPU FP64 Schwarzschild geodesic | 建立 ground truth |
| **1 Flat Space** | 星空/UV Grid | 普通直线相机 | 相机、坐标、HDR 基础正确 |
| **2 Schwarzschild Sky** | 黑洞 + UV Grid | 引力透镜、capture | 测地线和 shadow |
| **3 Thin Disk Geometry** | 单色薄盘 | 曲线与盘求交、多重像 | 几何拓扑正确 |
| **4 Relativistic Disk** | 旋转薄盘 | gravitational + Doppler shift/beaming | 辐射变化正确 |
| **5 Physical Spectrum** | 热薄盘 | 黑体谱、XYZ/RGB | 颜色与亮度正确 |
| **6 Slow-light / Observer** | hotspot + 移动相机 | 传播时间、observer tetrad | 时域相对论 |
| **7 Beam Filtering** | 星空 + 极细盘环 | beam footprint / AA | 临界区域稳定 |
| **8 Kerr Geometry** | 无盘或简单盘 | spin / frame dragging | 旋转时空正确 |
| **9 Kerr Physical Disk** | Kerr + 热薄盘 | spin-dependent ISCO / orbit | 完整实时薄盘模型 |
| **10 Volumetric GRRT** | 半透明 plasma | emission + absorption integral | 光学薄吸积流 |
| **11 GRMHD / polarization** | 数据驱动 plasma | GRMHD、synchrotron、偏振 | 科研级扩展 |

其中我认为 **Case 0–9 是你的“实时视觉黑洞 renderer”主线**。Case 10–11 已经从一个 graphics effect 开始转向 GRRT renderer。

---

# Case 0：先写一个完全不可实时的 Reference Integrator

这个步骤非常重要，甚至应该在 GPU Shader 之前。

设：

\[
G=c=M=1
\]

也就是所有距离用

\[
r_g=\frac{GM}{c^2}
\]

归一化。

写一个 CPU FP64 Schwarzschild null geodesic integrator：

```cpp
struct Photon
{
    double4 x; // spacetime position
    double4 p; // momentum
};
```

可以使用高精度自适应 Dormand–Prince / RK45。

**不要求快。**

它负责生成：

```text
initial camera ray
      ↓
reference integration
      ↓
escaped direction
captured?
closest approach
disk intersections
travel time
```

以后 GPU LUT、RK4、Kerr、缓存方案全部和它比较。

### 固定一组 regression rays

至少固定这些：

```text
radial outward
radial inward

weak deflection
near photon sphere

just outside critical impact parameter
just inside critical impact parameter

multiple orbit ray
```

Schwarzschild 下几个非常好的 sanity check：

\[
r_H=2M
\]

\[
r_{\mathrm{ph}}=3M
\]

以及远距离观察下捕获临界 impact parameter：

\[
b_c=3\sqrt3M\approx5.196152M
\]

所以例如测试：

```text
b = 5.0   → captured
b = 5.19  → captured / extremely sensitive
b = 5.20  → escape with very large deflection
b = 6.0   → escape
```

这组测试以后非常有价值。

---

# Case 1：Flat-space camera

### Scene

先完全关掉 GR：

```text
camera
   ↓
straight ray
   ↓
lat-long UV sphere / checker sky
```

不要一上来用真实银河贴图。

背景推荐：

```text
latitude lines
longitude lines

+X / -X
+Y / -Y
+Z / -Z

10° angle grid
```

例如：

```text
     +Y
      |
-X --+-- +X
      |
     -Y
```

这会立刻暴露：

- handedness
- spherical coordinates
- FOV
- pixel-center convention
- camera orientation
- cubemap convention

### 为什么把它单独作为 Case

否则等你看到：

> “Einstein ring 好像翻转了”

你会不知道是 GR 算错了还是 cubemap 的 Z 轴翻了。

---

# Case 2：Schwarzschild + Background Only

这是**第一个真正的黑洞**。

场景中没有吸积盘：

```text
Black hole
+
UV grid sky
```

只实现：

```text
camera ray
    ↓
Schwarzschild geodesic
    ↓
escaped → sample background
captured → black
```

画面应该马上出现：

- central black-hole shadow；
- background strongly distorted；
- Einstein ring；
- photon-sphere 附近越来越强的 winding。

这一步我建议同时实现 Debug Views：

```text
Ray Classification

red    = captured
green  = escaped
yellow = unresolved
```

以及：

```text
Deflection Angle
Travel Time
Minimum Radius
Step Count
```

这几个 debug buffer 后面会一直使用。

### 核心验收条件

不要看“是不是很像黑洞”，而看：

> 数值解与 Case 0 FP64 reference 是否一致。

比如记录：

\[
\epsilon_{\theta}=
\angle(\vec d_{\text{GPU}},\vec d_{\text{reference}})
\]

可以先定工程目标：

```text
normal area:
< 1e-4 ~ 1e-3 rad

critical region:
允许更大误差，但必须稳定收敛
```

---

# Case 3：纯几何 Thin Disk

现在才加入吸积盘。

但是此时：

**禁止 Doppler、禁止温度、禁止噪声、禁止 Bloom。**

建议使用：

```text
r_in  = 6M
r_out = 20M

infinitely thin
opaque
constant white radiance
```

甚至可以给盘加 checker：

```text
radial band  : r
angular band : φ
```

例如：

```text
R0 R1 R2 R3 ...
 \ |  |  /
  \|  | /
--- BLACK HOLE ---
```

这样你会非常容易看到：

### Direct image

相机直接看到的盘。

### Secondary image

来自盘背面、经过黑洞上方/下方折回来的像。

### Higher-order images

靠近临界曲线越来越细的额外图像。

NASA 的可视化实际上非常适合用来理解这种“盘背面的上下像”：盘并不是物理地弯起来，而是光路绕过黑洞。上面的 NASA reference 图也正是在展示这个关系。

### 这一 Case 的验收点

例如给一个盘 texel：

```text
(r = 10M, φ = 0)
```

跟踪它对应的：

```text
direct image
secondary image
...
```

确保屏幕上的 topology 是对的。

---

# Case 4：Orbital Motion + Relativistic Shift

这是第一次让画面变成大众认知中的“物理黑洞”。

给薄盘中的物质定义 circular orbit velocity。

然后对每次 ray/disk intersection 计算：

\[
g=
\frac{\nu_{\rm obs}}
{\nu_{\rm emit}}
=
\frac{p_\mu u^\mu_{\rm obs}}
{p_\mu u^\mu_{\rm emit}}
\]

这里同时包含：

- gravitational redshift；
- relativistic Doppler shift；
- relativistic beaming。

### Debug mode 非常重要

不要一开始直接输出 RGB。

先输出：

```text
g-factor visualization
```

例如：

```text
g < 1       → dark
g = 1       → gray
g > 1       → bright
```

然后测试：

```text
disk rotates CW
```

与：

```text
disk rotates CCW
```

亮暗两侧应该完全交换。

如果没交换，disk velocity/tetrad/光子 momentum 很可能有 bug。

---

# Case 5：Physical Spectrum

此时才加入“漂亮颜色”。

先使用最简单而又物理意义明确的：

## Black-body disk

定义：

\[
T(r)
\]

第一版甚至不用 Novikov–Thorne，可以先采用：

\[
T(r)=T_0
\left(\frac{r}{r_\mathrm{in}}\right)^{-3/4}
\]

作为测试模型。

然后利用：

\[
T_{\rm observed}=gT_{\rm emitted}
\]

计算 black-body spectrum。

我会预计算：

```text
Temperature
    ↓
CIE XYZ radiance
```

例如：

```text
BlackBodyLUT[2048]
```

shader：

```cpp
float observedTemperature = g * emittedTemperature;

float3 XYZ =
    BlackBodyLUT.Sample(observedTemperature);
```

再：

```text
XYZ
 ↓
linear RGB
 ↓
HDR buffer
```

Bruneton 的实现也把相对论 Doppler/beaming 与光谱颜色转换作为独立处理，并使用预计算颜色映射。:chatgpt-content-reference{index="3"}

### 到这里再加 Exposure

而且顺序应该明确：

```text
physical radiance
      ↓
relativistic transfer
      ↓
scene-linear HDR
      ↓
exposure
      ↓
tone mapping
```

不是：

```text
pretty disk color
× magic Doppler brightness
```

---

# Case 6：Time Delay / Moving Observer

这一 Case 特别值得做，因为很多 realtime 黑洞 renderer 到这里就不再正确了。

## Case 6A：Hot spot

薄盘里只放一个热点：

```text
    *
  disk
```

让它绕黑洞运行。

对于某个 pixel：

\[
t_e=t_o-\Delta t
\]

采样：

```cpp
HotSpot(position, observationTime - rayTravelTime);
```

而不是：

```cpp
HotSpot(position, currentTime);
```

此时不同阶的像会显示热点在**不同历史时间的位置**。

这是一种非常好的 visual validation。

Blacklight 将这种传播时间处理称为 slow-light，并把它作为更完整 GR ray tracing 功能的一部分。:chatgpt-content-reference{index="4"}

## Case 6B：Observer motion

然后加入：

```text
static observer
free-fall observer
orbiting observer
```

正确做法是在 observer 位置建立局部 tetrad：

```text
pixel direction
      ↓
local observer frame
      ↓
spacetime photon 4-momentum
```

你会开始看到：

- relativistic aberration；
- Doppler shift；
- beaming；
- time dilation related visual behavior。

Bruneton 的 demo 本身就提供 static/free-falling observer 的对照，因此它也是一个非常合适的验证 reference。:chatgpt-content-reference{index="5"}

---

# Case 7：真正解决 AA，而不是交给 TAA

这一步我会**刻意放在 Kerr 之前**。

因为到 Case 3–6，你已经会发现：

```text
photon ring
secondary disk image
stars
```

可能小于一个像素。

如果此时再继续增加 Kerr，错误会越来越难区分：

```text
物理误差
vs
sampling artifact
```

### Case 7A

纯 UV grid。

测试：

```text
pixel footprint after lensing
```

### Case 7B

加入 point stars。

此时就必须区分：

```text
extended source
point source
```

Bruneton 的方法专门使用 beam tracing 和针对恒星的过滤，而不是简单把一个方向查 cubemap。:chatgpt-content-reference{index="6"}

### Case 7C

打开 disk photon rings。

用：

```text
1 spp
4 spp
16 spp
64 spp reference
```

比较能量。

我会把 **64/256 spp 离线 reference** 留在 debug 模式里。

---

# Case 8：Kerr Geometry

到这里再开始旋转黑洞。

而且：

**第一张 Kerr 图不要带复杂吸积盘。**

重新使用 Case 2：

```text
Kerr black hole
+
UV grid background
```

这能让你明确观察：

- shadow asymmetry；
- frame dragging；
- photon orbit structure；
- spin orientation。

GRay2 是非常合适的实现参考，因为它针对 GPU 的 Kerr geodesic 使用 Cartesian Kerr–Schild coordinates，并提供了 convergence tests。:chatgpt-content-reference{index="7"}

### 固定一组 spin regression

我建议：

| Test | \(a_*\) | disk/orbit |
|---|---:|---|
| K0 | 0.0 | Schwarzschild reference |
| K1 | +0.5 | prograde |
| K2 | +0.9 | prograde |
| K3 | +0.99 | near-extreme |
| K4 | -0.9 | retrograde |

最重要的是：

\[
a_*\rightarrow0
\]

时必须收敛到 Case 2–7 的 Schwarzschild 结果。

这是最有价值的 Kerr unit test。

---

# Case 9：Kerr + Physical Accretion Disk

现在才把前面所有模块重新组合：

```text
Kerr spacetime
       ↓
geodesic
       ↓
Kerr circular orbit
       ↓
spin-dependent ISCO
       ↓
temperature / emissivity
       ↓
g-factor
       ↓
spectrum
```

这时建议把简单温度 profile 换成：

## Novikov–Thorne thin disk

并让内边缘：

\[
r_{\rm in}=r_{\rm ISCO}(a)
\]

所以不同 spin 会同时改变：

```text
geometry
orbital velocity
disk inner radius
temperature
redshift
```

这才是“spin slider”真正应该产生的效果。

Odyssey 正是一个 GPU Kerr geodesic + general-relativistic radiative transfer 实现，因此 Case 8–9 特别适合用它做数值结果对照。:chatgpt-content-reference{index="8"}

### 到 Case 9，我认为第一版就完成了

实际上：

> **Case 9 已经可以成为你 30 fps realtime renderer 的最终主目标。**

视觉效果可以非常丰富，而且核心物理已经相当完整。

---

# Case 10：Optically Thin GR Radiative Transfer

这时黑洞 renderer 才从：

```text
surface ray tracing
```

升级为：

```text
volume radiative transfer
```

不再是：

```cpp
if (rayHitsDisk)
    return diskRadiance;
```

而是在 geodesic 上积分：

\[
\frac{dI_\nu}{d\lambda}
=
j_\nu-\alpha_\nu I_\nu
\]

在 relativistic invariant formulation 中进行计算。

于是可以模拟：

```text
hot plasma
RIAF
corona
jet
optically thin accretion flow
```

Blacklight 支持 Kerr 周围的 GR radiative transfer、adaptive ray tracing、slow-light，并且可以直接处理 GRMHD 数据；这基本就是 Case 10 以后应该参照的架构。:chatgpt-content-reference{index="9"}

此时我才会考虑：

```text
ray compaction
adaptive integration
foveated sampling
temporal reuse
```

因为真正昂贵的已经变成：

> 每个 pixel × 数百 geodesic steps × radiative evaluation。

---

# Case 11：GRMHD / Synchrotron / Polarization

这应该当作研究性扩展，而不是第一版功能。

数据可能来自：

```text
H-AMR
BHAC
KORAL
AthenaK
...
```

renderer 读取：

```text
density
electron temperature
magnetic field
4-velocity
```

然后计算：

```text
synchrotron emission
absorption
Faraday rotation
Faraday conversion
```

最后传输 Stokes vector：

\[
(I,Q,U,V)
\]

这已经接近 EHT 模拟软件的用途。

Blacklight 和 `grtrans` 都是这一方向的参考；后者明确实现了 Kerr 时空中的偏振 radiative transfer。:chatgpt-content-reference{index="10"}

---

# 我会把你实际的开发 milestone 压缩成这五个

虽然上面有 12 个 Case，但在 Metallic 里我会按五个里程碑组织：

| Milestone | Cases | 产物 |
|---|---|---|
| **M1 Geometry** | 0–2 | Schwarzschild geodesic renderer |
| **M2 Disk** | 3–5 | physically shaded thin disk |
| **M3 Temporal/Image Quality** | 6–7 | slow-light + beam filtering |
| **M4 Kerr** | 8–9 | 完整 realtime Kerr thin-disk renderer |
| **M5 GRRT** | 10–11 | volumetric/GRMHD research renderer |

其中 **M4 就是我认为值得先锁定的最终目标**：

```text
RTX 5070 Ti
2560×1440
30+ FPS

Kerr spacetime
free camera

thin disk
Novikov-Thorne emission

gravitational redshift
Doppler shift
beaming

multiple images
time delay

physical black-body spectrum
beam-aware filtering

HDR output
```

而暂时**不要**把下面这些放到 M4 前：

```text
procedural turbulence
cinematic lens flare
huge bloom
GRMHD
jets
polarization
volumetric scattering
DLSS/TAA temporal reconstruction
```

因为它们都会掩盖几何或辐射传输错误。

---

## 另外，我强烈建议每个 Case 都保留成可运行场景

不要升级后删掉旧的测试。

最终项目里可以有：

```text
BlackHoleTests/
 ├── 00_Reference
 ├── 01_FlatGrid
 ├── 02_SchwarzschildGrid
 ├── 03_SchwarzschildDiskGeometry
 ├── 04_GFactor
 ├── 05_BlackBodyDisk
 ├── 06_HotSpotSlowLight
 ├── 07_BeamFiltering
 ├── 08_KerrGrid
 ├── 09_KerrThinDisk
 ├── 10_GRRT
 └── 11_GRMHD
```

同时 Shader 中保留类似：

```cpp
enum BlackHoleDebugMode
{
    Final,

    RayClassification,
    DeflectionAngle,
    ClosestRadius,

    GeodesicStepCount,
    GeodesicError,

    DiskImageOrder,
    DiskRadius,
    DiskAzimuth,

    GFactor,
    TravelTime,

    BeamSolidAngle,
};
```

**`DiskImageOrder` 特别值得做。** AART 的核心思想之一正是针对 Kerr 强透镜形成的不同 photon/lensing bands 做自适应采样，而不是把全屏像素一视同仁。:chatgpt-content-reference{index="11"} 等你以后开始优化 RTX 5070 Ti 上的 30 fps，它可以自然演化为：

```text
Primary rays
        ↓
classify critical/lensing bands
        ↓
normal region → cheap path
critical region → expensive integration / supersampling
```

这会比一开始就全屏暴力 RK4 × 256 steps 更有发展空间。

**因此如果现在就开始写，我建议第一周的目标甚至不是“画出漂亮黑洞”，而是做完 `Case 0 → Case 2 → Case 3`：FP64 reference、Schwarzschild UV-grid lensing、单色 checker thin disk。** 一旦这三关数值和几何都可靠，后面的 Doppler、光谱、Kerr 其实是在一套可信基础上逐层增加物理，而不是在一张看起来像黑洞的图片上不断猜哪里出了问题。