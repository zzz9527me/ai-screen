# Implementation Plan: Snipaste 风格截屏

**Feature**: `specs/002-snipaste-screenshot/spec.md`
**Created**: 2026-10-19
**Status**: Implemented (v1)

## 1. 目标

把现有“透明选区层 + 独立编辑窗口”的两段式截屏,重构为 Snipaste 式 **冻结画面 → 就地框选 → 就地标注 → 保存/复制/贴图** 单层工作流。

## 2. 架构

### 2.1 主进程

- `openScreenshot()`:
  1. 先调用 `capturePrimaryScreen()` 获取主屏冻结图(PNG data URL + 物理尺寸)。
  2. 打开全屏无边框窗口(覆盖主屏,置顶、跳过任务栏),加载 `screenshot` 渲染页。
  3. 页面加载完成后通过 `IPC.ScreenshotImage` 发送冻结图。
  4. 不再调用 `showRegionSelector()`,不再在主进程裁剪;选区与裁剪在渲染层完成。
- `screenshotWindow.ts`:
  - 主屏 `bounds` 尺寸、`frame:false`、`alwaysOnTop`、`skipTaskbar:true`、`resizable:false`、`useContentSize:true`。
  - 单例:已存在则聚焦。
  - 关闭时清理 `allowWebContents`。
- `openScreenshot` 捕获失败时显示错误通知。
- 录屏路径(`showRegionSelector`)保持原样,不受影响。

### 2.2 IPC

复用现有:

- `ScreenshotImage`:主进程 → 截屏窗口,发送 `{ dataUrl, width, height }`。
- `ScreenshotSave`:PNG data URL → 配置目录,返回路径。
- `ScreenshotCopy`:PNG data URL → 剪贴板。

新增:

- `ScreenshotPin`:PNG data URL → 主进程创建置顶贴图窗口。
- `PinImage`:主进程 → 贴图窗口,发送合成后的图片。

### 2.3 贴图窗口

- 新增 `src/main/windows/pinWindow.ts`。
- 无边框、置顶、可拖动、可调整大小(首版可固定尺寸),右上角关闭按钮。
- 渲染页 `src/renderer/pin/`,显示图片,拖动区使用 `-webkit-app-region: drag`,关闭按钮 `no-drag`。
- 双击图片关闭窗口。
- 首版不做缩放/旋转/翻转/透明度/鼠标穿透。

## 3. 截屏渲染层(`src/renderer/screenshot`)

### 3.1 分层结构

```text
.screenshot-overlay
├── img.frozen-screen        // 冻结画面,铺满主屏
├── .dim (无选区时)          // 全屏半透明黑
├── .selection               // 选区 div,box-shadow 实现外部变暗
│   └── .annotation-clip     // overflow:hidden
│       └── canvas           // 原图物理分辨率,标注坐标 = 图像物理坐标
├── .selection-handles ×8
├── .selection-size          // 宽×高 DIP
├── .toolbar                 // 选区下方/上方,自动翻转
├── .magnifier               // 放大像素/坐标/HEX
├── .crosshair               // 水平/垂直参考线
└── .text-input              // 文字输入浮层
```

### 3.2 坐标模型

- 冻结图物理尺寸:`image.width × image.height`。
- 主屏 DIP 尺寸:`display.width × display.height`(由窗口内容区推导)。
- `scale = image.width / display.width`(X/Y 同比例;主屏 DIP 与物理像素同比例)。
- 选区存储为 **DIP**;标注存储为 **图像物理坐标**。
- 鼠标坐标转换:`imageX = clientX * scale`,`imageY = clientY * scale`。
- 保存时按选区物理矩形裁剪,并用 `translate(-selX*scale, -selY*scale)` 重绘标注。

### 3.3 选区交互

- 无选区:全屏变暗,十字光标,拖动创建选区。
- 有选区:边框 + 8 个控制点;内部拖动在“移动”工具下移动选区;控制点缩放;最小 16×16 DIP;限制在视口内。
- 选区外点击开始新选区(清空标注/历史)。
- 尺寸徽标显示 `W × H` DIP。
- Esc 退出。

### 3.4 工具栏

- 工具:移动、矩形、椭圆、直线、箭头、画笔、马克笔、文字、马赛克。
- 操作:撤销、重做、6 色色板、保存、复制、贴图、取消。
- 位置:优先选区下方 8px;空间不足放上方;水平居中并夹紧到视口。
- 点击工具栏不触发选区交互。

### 3.5 标注数据模型

```ts
type Annotation =
  | { kind: 'rect' | 'ellipse' | 'line' | 'arrow'; start: Point; end: Point; color: string; width: number }
  | { kind: 'pen' | 'marker'; points: Point[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'mosaic'; start: Point; end: Point }
```

- 新标注 push 到 `annotations`,`redoStack` 清空。
- 撤销:pop 到 `redoStack`;重做:反向。
- 渲染:每帧清空 canvas → 重绘所有标注 → 预览当前拖拽。
- 马赛克:从冻结图裁剪区域,缩小再放大(`imageSmoothingEnabled=false`)。
- 文字:点击位置 → 浮层 input → 读取 DOM value(非受控)提交,Enter/失焦提交,Esc 取消,IME 组合输入不误提交。

### 3.6 放大镜 / 取色

- 指针移动时,从冻结图 `getImageData` 取 7×7 像素,放大 16 倍绘制。
- 显示 `X, Y`(DIP)、`#RRGGBB`、颜色块。
- 靠近屏幕边缘自动翻转,避免超出视口。
- 工具栏/文字输入上方不显示。

### 3.7 合成与输出

- `composeSelection()`:
  1. 创建 `selW×selH` 物理像素 canvas。
  2. 绘制冻结图的选区部分。
  3. `translate(-selX,-selY)`,重绘全部标注。
  4. `toDataURL('image/png')`。
- 保存/复制/贴图均使用该合成结果。
- 保存成功后关闭截屏层;复制成功后关闭;贴图成功后关闭。

### 3.8 快捷键

- `Esc`:关闭。
- `Ctrl+C`:复制。
- `Ctrl+S`:保存。
- `Ctrl+Z`:撤销。
- `Ctrl+Y` / `Ctrl+Shift+Z`:重做。
- `F3`:贴图。

## 4. 设置与快捷键

- 沿用现有 `screenshotShortcut` 设置(默认 `CommandOrControl+Shift+S`)。
- 托盘「截屏」与全局快捷键走同一 `openScreenshot`。
- 设置窗口文案更新为“触发后在屏幕上框选区域”。

## 5. 文件变更

新增:

- `src/main/windows/pinWindow.ts`
- `src/renderer/pin/index.html`
- `src/renderer/pin/src/main.tsx`
- `src/renderer/pin/src/App.tsx`
- `src/renderer/pin/src/pin.css`
- `specs/002-snipaste-screenshot/*`

重构:

- `src/main/index.ts`:`openScreenshot` 改为先冻结截屏再打开全屏层。
- `src/main/windows/screenshotWindow.ts`:全屏冻结层;不再按图片尺寸开窗。
- `src/renderer/screenshot/src/App.tsx`:完全重写为冻结画面选区 + 标注。
- `src/renderer/screenshot/src/editor.css`:全屏层样式。
- `src/shared/ipc-channels.ts` / `types.ts` / `schemas.ts` / `preload/index.ts`:增加贴图 IPC。
- `src/main/ipc/handlers.ts`:贴图 handler。
- `electron.vite.config.ts`:增加 `pin` 入口。

移除/停用:

- 截屏流程不再使用 `showRegionSelector` + 主进程裁剪(`cropScreenshot` 可保留为后续或删除)。
- 原独立编辑窗口尺寸逻辑删除。

## 6. 验证策略

### 6.1 自动化 UI 模拟

扩展 `DSH_DIAGNOSE`:

1. 触发截屏 → 等待全屏冻结层。
2. 拖拽 600×400 DIP 选区 → 检查工具栏、尺寸、放大镜。
3. 画箭头 → 画矩形/椭圆 → 输入两段文字(Enter 与失焦保存)。
4. 撤销/重做 → 检查 canvas 像素变化。
5. 保存 PNG → 检查尺寸、标注像素、文件存在。
6. 复制 → 主进程 `clipboard.read()` 检查 `image/png`。
7. 贴图 → 检查贴图窗口存在、尺寸、关闭。
8. 收集所有控制台/页面错误,要求 0。

### 6.2 单元测试

- 快捷键格式化、旧设置迁移、截图文件名唯一性(已有)。
- 新增纯函数测试:选区 clamp/命中控制点/颜色格式(若抽出).
- 录制回归 52 项测试保持通过。

### 6.3 打包验证

- 构建 NSIS + portable。
- 打包版重复 6.1,确认 asar 内页面/IPC/贴图正常。

## 7. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 全屏 canvas 标注在 4K 下性能 | 标注 canvas 仅覆盖选区,绘制简单;冻结图为静态 <img> |
| 文字输入 IME 组合 | 非受控 input + `isComposing` 保护 |
| 高 DPI 坐标错位 | 统一用 `image.width / display.width` 比例 |
| 贴图窗口抢焦点 | 基础置顶、可拖动;不做穿透 |
| 录屏回归 | 不改录制 session;只改截屏窗口与 IPC |
| 选区调整后标注错位 | 标注锚定图像物理坐标,由选区裁剪;移动/缩放不会改变标注位置 |

## 8. 首版不实现

- 自动窗口/元素检测。
- 多显示器。
- 历史回放。
- OCR。
- 标注二次变形。
- 贴图高级变换/GIF/分组。
- 高斯模糊/橡皮擦。
