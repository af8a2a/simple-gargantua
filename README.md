# Simple Gargantua

基于 **three.js** 的实时 Kerr 黑洞可视化。在交互帧率（目标 ≥ 30 fps）下，用片元着色器做广义相对论光线弯曲，呈现事件视界阴影、光子环、吸积盘与多普勒束。

## 特性

- **Kerr 时空**：可调自旋 $a/M \in [0, 0.99]$；视界 $r_+$、ISCO、光子轨道随自旋变化
- **Hamiltonian 测地线**：Cartesian Kerr–Schild 坐标，状态 $(x^\mu, p_\mu)$，用 RK4 积分下列方程（形式参考 Blacklight，[arXiv:2203.15963](https://arxiv.org/abs/2203.15963)）
- **临界区 / 高阶像**：透镜带自适应步长、半轨道数分层的高阶盘像、解析光子环（思路参考 AART，[arXiv:2211.07469](https://arxiv.org/abs/2211.07469)）
- **吸积盘物理**：Kerr 开普勒角速度、参考系拖曳、多普勒束与引力红移、黑体温度梯度
- **离线单页**：`index.html` 内联 three.js 与着色器，Edge/Chrome 可直接打开

测地线 Hamilton 形式（$\lambda$ 为仿射参数）：

```math
\frac{\mathrm{d}x^\alpha}{\mathrm{d}\lambda} = g^{\alpha\beta} p_\beta
```

```math
\frac{\mathrm{d}p_i}{\mathrm{d}\lambda} = -\frac{1}{2} \partial_i g^{\alpha\beta} p_\alpha p_\beta
```

## 运行

### 方式一：本地 HTTP（推荐）

```bash
# 仓库根目录
python -m http.server 8765
# 或
npm run serve
```

浏览器打开：**http://127.0.0.1:8765/**

### 方式二：直接打开文件

双击 `index.html`，或在 Edge/Chrome 中打开 `file://.../index.html`。  
（使用同目录 `lib/three.min.js`，无需 ES Module。）

若画面全黑，请开启浏览器硬件加速，或改用 HTTP 方式。

## 操作

| 操作 | 作用 |
|------|------|
| 拖拽 | 轨道相机 |
| 滚轮 | 推近 / 拉远 |
| 自旋 a | 改变黑洞自旋，观察阴影与 ISCO |
| 盘亮度 / 曝光 / 光子环辉光 | 调节画面 |
| 画质 LOW–ULTRA | 积分步数与分辨率缩放 |
| RESET VIEW | 恢复默认视角与参数 |

## 开发

```bash
npm install          # 可选：Playwright 验证脚本
npm run build        # 由 js/ + lib/ 重新生成自包含 index.html
npm run verify       # 无头截图检查
npm run verify:integrator -- --edge  # GLSL 守恒量、回溯方向与解析径向光线检查
```

源码结构：

```
index.html          # 自包含入口（经典脚本 + 内联 three.js）
js/shaders.js       # Kerr–Schild 度规、Hamiltonian 积分、吸积盘
js/main.js          # three.js 场景、相机、HUD
css/style.css       # 界面样式
lib/                # three.module.js / three.min.js
scripts/            # 构建与 Playwright 验证
```

## 技术说明

- 几何单位：$r_s = 2M = 1$，场景中自旋沿 $+Y$，Kerr–Schild 内部沿 $+z$
- 光线从相机向光源回溯：使用过去指向的零四动量与正仿射步长，满足 $dt/d\lambda < 0$；发射光朝向观察者的方向与回溯切向相反
- 帧率不足时会自动降低渲染分辨率

## 许可

可视化代码见本仓库；three.js 遵循其自身 MIT 许可。
