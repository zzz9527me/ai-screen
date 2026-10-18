# Phase 0 Research: 屏幕录制器 (Screen Recorder)

**Feature**: 001-screen-recorder | **Date**: 2026-10-18 | **Status**: All unknowns resolved

本文件记录实现计划的技术决策、理由与被否决的替代方案。所有版本均为 2026-10-18 查询 npm registry 得到的最新兼容版本。

## 1. 运行时、构建工具链与打包

- **Decision**: Electron `44.9.0`（Chromium `152.0.7977.54`、Node.js `24.18.1`、V8 15.2）、electron-vite `6.0.0` + Vite `8.3.4`、React `19.3.1`、TypeScript `5.9.3`、electron-builder `26.15.3`（NSIS 安装包 + portable 免安装版，win x64）、Vitest `5.0.5`、zod `4.6.7`、mediabunny `1.61.6`（MP4 复用器兜底）。
- **Rationale**:
  - Electron 44 对应 Chromium 152，满足 Windows 10 及以上运行要求；Electron 44 起只发布 64 位构建（x64/arm64），因此交付目标锁定 **x64**。
  - `typescript@7.0.2`（原生编译器）虽为 latest，但 `typescript-eslint@8.71.2` 的 peer 范围是 `typescript >=4.8.4 <6.1.0`，含 TS 7 会导致 lint 工具链不兼容；选择最新 5.x 系列 `5.9.3` 保持整套工具兼容。
  - electron-vite 6 的 peer 依赖为 `vite ^6/^7/^8`，与 Vite 8.3.4 配套。
  - electron-builder 26.15.3 同时产出 NSIS 安装包（含卸载/开始菜单）与 portable 单文件，适配不同分发习惯。
- **Alternatives considered**:
  - Electron 43 系列：Chromium 版本更旧，无必要。
  - TypeScript 7.0.2：待 typescript-eslint 支持后升级，本期不采用。
  - 仅 portable 或仅 MSI：portable 缺少安装体验，MSI 无额外收益。

## 2. 桌面捕获 API

- **Decision**: 渲染进程调用 `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } })`；主进程通过 `session.defaultSession.setDisplayMediaRequestHandler((request, callback) => callback({ video: chosenSource }))` 指定捕获源。捕获源由 `desktopCapturer.getSources({ types: ['screen', 'window'] })` 获取，并在我们的 UI 中由用户选择。
- **Rationale**: 这是 Electron 当前推荐路径（官方文档示例即此方式），无需 `chromeMediaSource` 约束，屏幕与窗口源统一处理；用户选择完全由应用内 UI 决定，不依赖系统选择器（Windows 上默认也没有）。
- **Risk / fallback**: `getDisplayMedia` 在 Chromium 中受瞬态用户激活（transient activation）限制。捕获渲染进程由主进程创建、并非用户直接点击的窗口，可能拿不到激活。若实测被阻止，回退为 `navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } })`（Electron 仍支持，无激活要求）。计划在实现阶段第 1 个任务验证此行为。
- **Alternatives considered**:
  - 仅 legacy `getUserMedia` + `chromeMediaSource`：已废弃，长期风险高。
  - 自研 Win32/WGC 原生插件：需要 native addon 构建链，违背“Electron + TypeScript”的简单交付目标。

## 3. 全屏捕获目标

- **Decision**: 仅捕获主显示器（spec FR-005 澄清结果）。主进程用 `screen.getPrimaryDisplay()` 获取 DIP 边界与 `scaleFactor`；在 `desktopCapturer` 的 `screen` 源中按 `display_id` 匹配主显示器（匹配失败则取第一个 screen 源）。
- **Rationale**: 与澄清结果一致，避免多显示器拼接/选择器的复杂度。
- **Alternatives considered**: 整个虚拟桌面或用户选择显示器（均因澄清结论否决）。

## 4. 选定区域：框选与裁剪

- **Decision**:
  - 主进程创建透明无边框置顶全屏 `BrowserWindow`（覆盖主显示器 DIP 边界，`skipTaskbar`、`alwaysOnTop`），渲染层绘制暗色遮罩 + 拖拽选框，鼠标抬起确认，ESC 取消；最小 16×16 DIP。
  - 设置界面提供数值形式的 `x/y/width/height`（DIP）输入，保存前用 zod 校验：整数、宽高 ≥ 16、区域完全落在主显示器 DIP 边界内。
  - 录制时在 canvas 上按物理像素裁剪：`physX = round(x * scaleFactor)`，输出尺寸 = 物理区域尺寸。
- **Rationale**: `getDisplayMedia` 无法直接按任意矩形裁剪；canvas 裁剪可保证输出分辨率精确等于所选区域（spec SC-004），并统一 DPI 换算逻辑（可单元测试）。
- **Alternatives considered**:
  - 使用系统级区域捕获（Windows 无对外 API）；放大镜+离屏渲染（复杂且脆弱）。

## 5. 帧合成管线

- **Decision**: 隐藏的捕获渲染进程（`show: false`、`webPreferences.backgroundThrottling: false`、`sandbox: true`）承载媒体引擎：
  1. `getDisplayMedia` 得到 `MediaStream` → `<video>` 元素（muted、playsinline）；
  2. 每帧通过 `requestVideoFrameCallback`（不可用时回退 `requestAnimationFrame`）把视频画到固定尺寸 canvas（全屏=整帧；区域=按物理坐标裁剪；窗口=缩放绘制到初始窗口尺寸）；
  3. `canvas.captureStream(30)` 交给 `MediaRecorder`；
  4. 录制期间主进程保持 `powerSaveBlocker('prevent-display-sleep')`。
- **Rationale**: 三种模式共用一条管线，输出尺寸固定（窗口缩放时画面按比例缩放而非改变分辨率），编码输入稳定，便于满足 MP4 与分辨率的验收标准。
- **Alternatives considered**:
  - 全屏直接录制 display 流、区域/窗口另走管线：两条管线、维护成本高，且区域仍需 canvas。
  - 直接 `canvas.captureStream` 前不经过 video 元素：无法对窗口尺寸变化做缩放归一化。

## 6. 编码与 MP4 封装

- **Decision**:
  - 启动录制前做能力探测：按顺序检查 `MediaRecorder.isTypeSupported()`：`video/mp4;codecs=avc1.42001F` → `video/mp4;codecs=avc1` → `video/mp4`。命中则直接产 MP4（H.264）。探测在捕获渲染进程执行（`MediaRecorder` 仅存在于渲染进程）；主进程随 `capture:begin` 下发候选列表，渲染进程在 `capture:ready` 报告中选中的 mimeType，主进程据此判定 `UNSUPPORTED_MP4`。
  - 码率策略：1080p30 约 8 Mbps（≈0.15 bit/像素/帧），按输出像素数缩放，上限 20 Mbps；`MediaRecorder.start(1000)` 每秒切片。
  - **兜底方案（仅在探测全部失败时启用）**：WebCodecs `VideoEncoder`（`avc1`）+ mediabunny 的 MP4 复用器，输出同样为 MP4；若连 WebCodecs H.264 编码器也不可用，则明确报错「当前环境不支持 MP4 录制」，不产生非 MP4 文件。
- **Rationale**: Chromium 长期维护 MediaRecorder 的 MP4 muxer（近期 Chromium 提交为 MediaRecorder 增加 `avc3`/`hev1` 的 muxer 支持），Electron 44 的 Chromium 152 可直接输出 MP4，省去转码等待（满足 SC-007「停止后 5 秒内可播放」）。mediabunny 是已废弃 `mp4-muxer` 的官方继任者（`mp4-muxer@5.2.2` 已在 npm 标记 deprecated）。
- **Alternatives considered**:
  - 录 WebM 再用 ffmpeg 转 MP4：引入 ffmpeg 二进制与转码延迟，10 分钟视频远超 5 秒，否决。
  - 一律使用 WebCodecs + mediabunny：可行但代码量更大，作为兜底保留。

## 7. 文件写入与崩溃恢复

- **Decision**: `MediaRecorder` 的 `dataavailable` 事件 → 渲染进程经 IPC 把 `ArrayBuffer` 块发给主进程 → 主进程 `fs.createWriteStream` 追加写入。停止时关闭流并做完整性检查（文件 > 1 KB 且前 8 字节包含 `ftyp`）。同时维护会话标记文件 `userData/recording-session.json`（输出路径、开始时间、模式）：开始时写入，正常完成/失败时删除；下次启动若发现残留标记，用系统通知提示「上次录制可能未完成」，保留文件并报告。
- **Rationale**: 边录边写避免长录制内存暴涨；标记文件满足「不得静默丢失、损坏需明确报告」的章程要求；`ftyp` 检查能廉价发现明显损坏的 MP4。
- **Alternatives considered**:
  - 内存 Blob 到结束再写盘：1 小时录制可达数 GB，内存不可接受。
  - 周期性重封装修复：缺少可靠的纯 JS 修复手段，复杂度高，暂不实现。

## 8. 设置持久化

- **Decision**: 自研轻量设置模块：`userData/settings.json`，zod schema 校验，原子写入（写临时文件后 `rename`）；默认存储目录 `%USERPROFILE%\Videos\DSH Screen Recorder`（`app.getPath('videos')` 子目录），默认区域 `{0,0,1280,720}` 并夹取到主显示器边界内；文件损坏或版本未知时备份后重置默认值。
- **Rationale**: 无额外依赖、纯逻辑可单测、原子写避免半写损坏；`electron-store@12` 为 ESM-only 且包体更大，收益有限。
- **Alternatives considered**: electron-store 12、conf、YAML/TOML（均无必要）。

## 9. IPC 与安全基线

- **Decision**: 所有渲染窗口 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；preload 通过 `contextBridge` 暴露类型化 API；主进程对每个 IPC 载荷做 zod 校验，并校验发送方 `webContents.id` 在允许列表内；HTML 设置 CSP（`default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'`）；单实例锁；`Menu.setApplicationMenu(null)`；禁止导航与新窗口。
- **Rationale**: 遵循 Electron 安全清单；本地离线应用，攻击面很小，但仍默认加固。
- **Alternatives considered**: 捕获渲染进程开启 Node 集成（无必要且不安全）。

## 10. 托盘与交互流程

- **Decision**:
  - `Tray` + ICO 图标；右键动态构建菜单：空闲时「录屏 / 设置 / 退出」；录制中「停止录制 / 设置 / 退出」。录制中退出先确认「正在录制，是否停止并退出？」。
  - 点击「录屏」打开模式选择窗口（居中、小尺寸、无边框），包含：三模式单选、「开始」按钮；区域模式显示数值区域编辑器 + 「框选」按钮；窗口模式显示可捕获窗口列表（缩略图 + 标题）+ 刷新按钮。
  - 开始后关闭模式窗口；停止并保存成功时发系统通知（含文件名）；托盘 tooltip 反映状态。
- **Rationale**: 满足 FR-002/FR-003/FR-004 与 SC-001（≤10 秒发起录制）；单一对话框减少操作层级。
- **Alternatives considered**: 原生对话框（MessageBox）做模式选择：无法展示窗口缩略图与区域编辑器。

## 11. 窗口源过滤与跟踪

- **Decision**:
  - `desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })` 获取窗口列表。
  - 过滤规则：排除应用自身窗口（窗口标题统一带 `[SR]` 前缀，例如 `[SR] 录屏`，按前缀/精确标题排除）、排除空标题与已知系统窗口（如 `Program Manager`、`Windows 输入体验`）。
  - 录制中监听媒体轨 `ended` 事件（目标窗口被关闭时 Chromium 结束窗口捕获轨）→ 自动停止并保存已录制内容（spec US4 场景 3）。窗口最小化/遮挡不做特殊处理，画面反映窗口真实状态。
- **Rationale**: `DesktopCapturerSource` 不暴露进程/窗口句柄，标题约定是确定性最高的自过滤方式，且可单元测试。
- **Alternatives considered**: 原生 `EnumWindows` 插件（需 native 构建，放弃）。

## 12. 测试策略

- **Decision**:
  - Vitest 5.0.5 单元测试覆盖纯逻辑：settings schema/默认值夹取、区域 DIP↔物理像素换算与边界校验、文件名生成与去重、mime 探测顺序、`ftyp` 检查、窗口列表过滤、会话状态机。
  - Playwright 1.64.1（Electron）可选冒烟测试：应用启动、托盘存在性不可测但可测 IPC 往返与窗口加载。
  - 真实录制验证依赖 `quickstart.md` 的人工场景（三种模式、Win10/Win11 各一次），因为编码器/桌面捕获无法在 CI 中稳定模拟。
- **Rationale**: 确定性的数学与状态逻辑全部可自动化；媒体管线留给手工验收，符合 SC-003 的环境要求。
- **Alternatives considered**: 用 mock MediaRecorder 做端到端（脆弱，维护成本高）。

## 13. 发行与平台注意

- **Decision**: electron-builder `win.target: [nsis, portable]`，`arch: x64`，`appId: com.dsh.screen-recorder`，`productName: DSH 屏幕录制器`，`asar: true`，图标 `build/icon.ico`（256/128/64/32/16 多尺寸）；无自动更新；Windows 10 1809+ / Windows 11。
- **Rationale**: 覆盖安装与免安装两类用户；离线应用不需要更新服务。
- **Alternatives considered**: 自动更新基础设施（本期外）。

## Open Risks

1. **getDisplayMedia 用户激活限制**：隐藏窗口调用可能被 Chromium 拒绝；缓解=回退 legacy `chromeMediaSource` 约束（见 §2），首轮实现即验证。
2. **MediaRecorder MP4 支持**：Chromium 152 预期支持；仍保留启动时探测与 WebCodecs+mediabunny 兜底（见 §6）。
3. **H.264 硬件编码可用性**：兜底方案依赖 WebCodecs H.264 编码器；无硬件编码器的老机器可能不可用，届时明确报错（不产生非 MP4 文件）。
4. **超长录制（≥1 小时）**：流式写入已缓解内存；磁盘空间需在开始前检查（实现任务）。

## References

- [Electron 44.0.0 release (Chromium 152.0.7977.54 / Node 24.18.1, 仅 64 位)](https://releases.electronjs.org/release/v44.0.0)
- [Electron desktopCapturer 文档（setDisplayMediaRequestHandler / getDisplayMedia 示例）](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [npm registry: electron@latest = 44.9.0](https://registry.npmjs.org/electron/latest)
- [npm registry: electron-builder@26.15.3](https://registry.npmjs.org/electron-builder/latest)
- [npm registry: electron-vite@6.0.0](https://registry.npmjs.org/electron-vite/latest)
- [npm registry: typescript@7.0.2（最新，但受 typescript-eslint peer 限制未采用）](https://registry.npmjs.org/typescript/latest)
- [npm registry: typescript@5.9.3（采用）](https://registry.npmjs.org/typescript/5.9.3)
- [npm registry: typescript-eslint@8.71.2（peer typescript <6.1）](https://registry.npmjs.org/typescript-eslint/latest)
- [npm registry: vitest@5.0.5](https://registry.npmjs.org/vitest/latest)
- [npm registry: zod@4.6.7](https://registry.npmjs.org/zod/latest)
- [npm registry: mediabunny@1.61.6（mp4-muxer 的继任者）](https://registry.npmjs.org/mediabunny/latest)
- [npm registry: mp4-muxer@5.2.2（已标记 deprecated，未采用）](https://registry.npmjs.org/mp4-muxer/latest)
- [npm registry: @playwright/test@1.64.1](https://registry.npmjs.org/@playwright/test/latest)
