# DSH 屏幕录制器 (Screen Recorder)

Windows 10/11 托盘常驻的录屏 + 截屏工具,基于 **Electron 44 + TypeScript + React 19** 构建。

录屏支持全屏、区域、指定窗口三种模式,输出带时长元数据的 H.264 MP4;截屏采用 Snipaste 风格的冻结画面框选与就地标注,支持保存、复制和贴图。

## 功能

### 录屏

- **三种模式**:全屏(主显示器)、选定区域(拖拽框选或数值配置)、指定应用窗口
- **MP4 输出**:停止后生成 H.264 MP4(首版无音轨),30fps,自动校验文件完整性
- **时长元数据**:自动从分片计算并写入 `mvhd/tkhd/mdhd`,Windows 属性与播放器可正常显示时长
- **安全收尾**:目标窗口关闭自动停止;退出前确认;崩溃标记与下次启动提示
- **托盘优先**:默认收在系统托盘,右键菜单提供「录屏 / 截屏 / 设置 / 停止录制 / 退出」
- **设置持久化**:录制区域、文件存储位置、截屏快捷键

### 截屏(Snipaste 风格)

- **冻结画面**:触发后先冻结主屏并变暗,在冻结画面上框选,不再默认截全屏
- **精确选区**:8 个控制点缩放、拖动选区移动、宽×高 DIP 实时显示、最小 16×16、限制主屏
- **取色与放大镜**:显示光标附近的放大像素、DIP 坐标、HEX 颜色
- **就地标注**:矩形、椭圆、直线、箭头、画笔、马克笔、文字、马赛克
- **编辑能力**:撤销/重做、6 色色板、文字 Enter/失焦提交、IME 组合输入保护
- **输出**:
  - 保存 PNG 到配置的存储目录(`Screenshot_YYYYMMDD_HHmmss.png`)
  - 复制合成图到 Windows 剪贴板
  - **贴图**:生成无边框置顶图片窗口,可拖动、双击或点关闭按钮关闭
- **快捷键**:见下表

### 托盘与体验

- 统一深色设计令牌、清晰的主操作、悬停/按下/禁用/聚焦状态
- 高 DPI(100%–200%)适配
- 截屏工具栏根据选区位置自动放在下方或上方,避免超出屏幕

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 触发截屏 | 设置中配置,默认 `Ctrl+Shift+S` |
| 取消截屏 | `Esc` |
| 复制截图 | `Ctrl+C` |
| 保存截图 | `Ctrl+S` |
| 撤销标注 | `Ctrl+Z` |
| 重做标注 | `Ctrl+Y` / `Ctrl+Shift+Z` |
| 贴图 | `F3` |
| 停止录制 | 托盘右键 →「停止录制」 |

> 截屏快捷键是全局快捷键,应用在托盘时也生效;其余快捷键在截屏层打开时生效。

## 快速开始

### 使用安装包

构建后产物位于 `dist/`:

- `dist/DSH 屏幕录制器 Setup 1.0.0.exe` — NSIS 安装包
- `dist/DSH 屏幕录制器 1.0.0.exe` — portable 免安装版

安装或运行后,应用只显示托盘图标:

1. **录屏**:托盘右键 →「录屏」→ 选择模式 → 开始;停止时托盘右键 →「停止录制」
2. **截屏**:托盘右键 →「截屏」或按快捷键 → 拖动框选 → 标注 → 保存 / 复制 / 贴图
3. **设置**:托盘右键 →「设置」,可修改存储目录、默认区域、截屏快捷键

默认输出目录:`%USERPROFILE%\Videos\DSH Screen Recorder`

### 从源码运行

```powershell
npm install
npm run dev
```

## 技术栈

| 组件 | 版本 |
| --- | --- |
| Electron | 44.9.0(Chromium 152,x64) |
| TypeScript | 5.9.3 |
| electron-vite / Vite | 6.0.0 / 8.3.4 |
| React | 19.3.1 |
| zod | 4.6.7 |
| Vitest | 5.0.5 |
| electron-builder | 26.15.3 |

## 项目结构

```text
src/
├── main/                    # 主进程
│   ├── index.ts             # 启动、托盘、全局快捷键、窗口生命周期
│   ├── tray.ts              # 托盘菜单
│   ├── ipc/                 # IPC 注册与发送方校验
│   ├── services/            # 录制会话、设置、截图、文件、快捷键、通知
│   └── windows/             # 模式/设置/选区/捕获/截屏/贴图窗口
├── preload/                 # contextBridge API
├── renderer/
│   ├── mode/                # 录屏模式选择
│   ├── settings/            # 设置界面(区域/存储/快捷键)
│   ├── overlay/             # 录制区域框选
│   ├── capture/             # 隐藏录制管线(MediaRecorder → MP4)
│   ├── screenshot/          # Snipaste 风格冻结选区 + 标注层
│   ├── pin/                 # 置顶贴图窗口
│   └── common/              # 设计令牌、共享组件、全局类型
└── shared/                  # 类型、zod schema、IPC 通道、快捷键工具
tests/unit/                  # 单元测试
specs/                       # Spec Kit 规格、研究、计划、任务
```

## 开发与构建

```powershell
npm run compile   # 仅编译到 out/
npm run build     # NSIS 安装包 + portable 免安装版
```

常用校验:

```powershell
npm run typecheck
npm test
npm run lint
```

### 国内网络镜像

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
```

## 数据与缓存

- 设置与 Chromium 缓存:`%APPDATA%\dsh-screen-recorder\app-data`
- 若该目录不可写,应用自动回退到 `%TEMP%\dsh-screen-recorder`
- 录制文件:`<storageDirectory>/ScreenRecording_*.mp4`
- 截图文件:`<storageDirectory>/Screenshot_*.png`
- 默认存储目录:`%USERPROFILE%\Videos\DSH Screen Recorder`

## 端到端自检

设置环境变量后启动应用,会自动执行托盘交互、三种录屏、设置保存、冻结截屏、8 类标注、撤销/重做、保存/复制/贴图,并将结果写入 `diagnostic-result.json`:

```powershell
$env:DSH_DIAGNOSE='1'
npm run dev
```

该模式仅用于开发验证,正常使用不需要开启。

## 规格文档

- [001 录屏规格](specs/001-screen-recorder/spec.md)
- [002 Snipaste 风格截屏规格](specs/002-snipaste-screenshot/spec.md)
- [截屏功能调研](specs/002-snipaste-screenshot/research.md)
- [截屏实现计划](specs/002-snipaste-screenshot/plan.md)

截屏交互参考 [Snipaste](https://zh.snipaste.com/) 的公开功能与交互设计;本项目为独立实现。

## 已知限制(首版)

- 录制无音轨
- 录屏与截屏仅覆盖主显示器
- 截屏暂不含自动窗口/元素检测、OCR、历史记录回放、多屏、标注二次变形
- 贴图暂不含缩放、旋转、翻转、透明度、鼠标穿透、GIF、分组
- 仅支持 Windows 10 及以上 x64(Electron 44 不提供 32 位构建)
- 安装包未做商业代码签名,Windows SmartScreen 可能提示「未知发布者」

## 故障排查

- **托盘图标不见了**:检查任务栏右下角溢出区;应用默认不创建主窗口
- **截屏快捷键无效**:打开设置重新录制组合键;可能被其他程序占用
- **无法保存文件**:检查设置中的存储目录是否可写;应用会给出错误提示
- **启动报缓存/权限错误**:应用会自动改用 `%APPDATA%\dsh-screen-recorder\app-data` 或临时目录;若仍失败,请确认当前用户对 `%APPDATA%` 有写权限
- **SmartScreen 提示**:点击「更多信息」→「仍要运行」;或使用源码自行构建

## 仓库

[https://github.com/zzz9527me/ai-screen](https://github.com/zzz9527me/ai-screen)
