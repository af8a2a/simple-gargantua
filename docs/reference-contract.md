# Case 0 / 数值与比较契约 v1

`talk.md` 是路线图；本文件规定已实现的接口和验收边界。所有新物理机制必须保留旧 Case，不得把艺术效果或显示变换混入积分器。

## 单位与初始相机光线

- `G=c=M=1`，`r_H=2`，`r_ph=3`，`b_c=3√3`。
- 全局右手系，`+Y` 为盘法向。`position` 为 Schwarzschild areal Cartesian 坐标，即球坐标的笛卡尔表示，不是 Kerr–Schild 坐标。
- `direction` 为**静止观察者局部正交标架**的单位空间方向，分量沿全局径向/切向投影解释；它不是坐标速度。
- 相机 FOV 是垂直弧度，左上像素原点，采样位置 `(x+0.5,y+0.5)`。CPU 与 GPU 使用同一约定。
- 光线沿正仿射参数向过去追踪；归一化 `|E|=1`，`p_t=+1`，`t=-travelTime`。盘发射向观察者的物理光子方向与追踪切向相反。

## 积分方程

球对称保证轨道严格位于黑洞中心与初始切向确定的平面内，故无需积分有极轴奇点的 `(theta,phi)` 方程。初始径向单位矢量 `e_r0` 与归一化切向 `e_t0` 固定该平面；平面角 `phi` 连续展开，不取模。

```text
f(r) = 1 - 2/r
b = L/|E| = r0 * |n_t| / sqrt(f(r0))
state = [r, v_r, phi, elapsedTime]
dr/dlambda = v_r
dv_r/dlambda = b²(r-3)/r⁴
dphi/dlambda = b/r²
d(elapsedTime)/dlambda = 1/f(r)
v_r(initial) = n_r
null residual = |v_r² + f(r)b²/r² - 1|
```

这些是 Schwarzschild null geodesic 的精确约化式，遵循 `v_r² + fL²/r² = E²`。使用独立的一阶积分求积验证偏折与时间，不仅仅拿另一遍同一积分器当 ground truth。

最终输出 `photon.x=[t,x,y,z]` 和 **协变** `photon.p=[p_t,p_x,p_y,p_z]`：

```text
e_r(phi) = cos(phi)e_r0 + sin(phi)e_t0
e_t(phi) = -sin(phi)e_r0 + cos(phi)e_t0
x_spatial = r e_r
p_spatial = (v_r/f)e_r + (b/r)e_t
g_tt = -f
g_ij = delta_ij + (1/f - 1) e_ri e_rj
```

半径与 Schwarzschild 度规约定参见 [Tong 的广义相对论讲义](https://www.damtp.cam.ac.uk/user/tong/gr/grhtml/S1.html)；步进采用 [Dormand–Prince 5(4)](https://doi.org/10.1016/0771-050X(80)90013-3) 的嵌入式误差估计。

## 终止与几何事件

- `captured`：到达 `r=2+horizonEpsilon`，默认 `epsilon=1e-6`。这是视界外截断面，不能声称传播到视界的 Schwarzschild 坐标时间有限。
- `escaped`：到达 `escapeRadius` 且向外传播，默认 `1000M`。`escapedDirection` 是该有限面的归一化坐标切向，**不是无穷远方向**。比较时必须匹配边界；无穷远尾部外推尚未实现。
- `unresolved`：步数/仿射长度预算、浮点步长下溢或非有限状态。`captured=false` 且 `escapedDirection=null`，不得采样天空冒充已逃逸。
- 最近点由 `v_r=0` 事件定位，不是只取已接受步端点的最小值。被捕获时，最近半径是截断面半径。
- 盘为 `y=0` 的薄环，默认 `[6M,20M]`，记录所有穿越，不因第一个交点终止积分；用展开平面角隔离根，子步重积分二分定位。该探针独立于渲染 Case 3。
- 共面光线没有离散穿越，返回 `diskCoplanar=true` 和空交点；相机处自交不记录。后续实现不透明盘时需单独规定共面命中策略。
- `halfOrbit=floor(phi/pi)` 是追踪半绕行计数，**不是已验证的盘图像阶数**，未来 Case 3 必须建立更严格的 `DiskImageOrder` 定义。

## 精度、再现与比较

默认 `atol=1e-14, rtol=1e-13`；CPU 全程 `Number`，禁止降为 Float32。GPU 数据布局使用 Float32，仅用于被检验对象。误差由嵌入式 4/5 阶差估计；在接近视界或大曲率区额外限制步长。`maxSteps` 计数包含拒绝的尝试，诊断单独报告接受/拒绝步数。

固定输入在 `src/reference/regression-rays.js`。CLI 和浏览器 Worker 使用同一个实现与同一组输入。`npm run reference` 导出完整 JSON，包含 schemaVersion、单位、实际求解选项和初始光线；不随运行增加时间戳。输出放在忽略版本控制的 `output/`，验收依靠已入库测试与固定输入，避免自动重生成金标准将错误覆盖掉。

测试的 `b=b_c(1+10^-8)` 光线绕行超过 3 圈。临界区域会放大初值与截断误差：默认容差相对 `rtol=1e-14` 的方向差约 `2×10^-6 rad`（此输入与此逃逸面），不是对任意更临界光线的精度承诺。未来 GPU 比较必须同时保存容差收敛证据和最终分类，不得仅根据很小的 null 残差判断方向准确。

后续 Case 2 的 GPU/CPU 比较至少固定：初始相机光线、单位、逃逸面、捕获面、观察时刻；记录分类混淆、方向角误差、最近半径、传播时间和未解析比例。后续相邻 Case 的渲染 A/B 固定相机、分辨率、采样与显示配置，只改变该 Case 指定的机制。Case 0 无图像，不能假造与 Case 1 的视觉对照。
