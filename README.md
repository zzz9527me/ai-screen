# DSH 屏幕录制器 (Screen Recorder)

Windows 10/11 托盘常驻的屏幕录制工具,基于 Electron 44 + TypeScript + React 19 构建。

## 功能

- **三种录制模式**:全屏(主显示器)、选定区域(屏幕拖拽框选或数值配置)、指定应用窗口
- **截屏标注(Snipaste 风格)**:触发后先冻结主屏,拖拽框选区域;提供放大镜/取色、选区移动缩放、矩形/椭圆/直线/箭头/画笔/马克笔/文字/马赛克、撤销重做、6 色色板,以及保存 PNG、复制图片、贴图到屏幕
- **MP4 输出**:停止后生成 H.264 MP4(首版无音轨),自动校验文件完整性;自动从分片计算并写入时长元数据,Windows 属性与播放器可正常显示时长
- **托盘优先交互**:默认收在系统托盘;右键菜单包含「录屏 / 截屏 / 设置 / 停止录制 / 退出」
- **设置持久化**:录制区域范围、文件存储位置、截屏快捷键;配置写入 `userData` 并原子保存
- **健壮性**:单实例/单会话;目标窗口关闭自动停止;崩溃标记与下次启动提示;存储不可写时明确报错
- **体验**:统一设计令牌、高 DPI 适配、按钮状态反馈、主操作强调

## 技术栈

| 组件 | 版本 |
| --- | --- |
| Electron | 44.9.0 (Chromium 152, x64) |
| TypeScript | 5.9.3 |
| electron-vite / Vite | 6.0.0 / 8.3.4 |
| React | 19.3.1 |
| zod | 4.6.7 |
| Vitest | 5.0.5 |
| electron-builder | 26.15.3 |

## 开发

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run compile   # 仅编译 (out/)
npm run build     # NSIS 安装包 + portable 免安装版 (dist/)
```

## 测试与校验

```powershell
npm run typecheck
npm test
npm run lint
```

## 目录结构

```text
src/
├── main/          # 主进程:托盘、窗口、IPC、设置、录制会话、文件写入
├── preload/       # contextBridge API
├── renderer/      # mode/settings/overlay/capture 四个渲染入口 + 共享设计系统
└── shared/        # 类型、zod schema、IPC 通道、mime 候选
tests/unit/        # 单元测试
specs/             # Spec Kit 规格、计划、任务与检查清单
```

## 数据与缓存

- 设置与缓存:`%APPDATA%\dsh-screen-recorder\app-data`
- 若该目录不可写,应用自动回退到 `%TEMP%\dsh-screen-recorder`
- 录制文件默认位于 `%USERPROFILE%\Videos\DSH Screen Recorder`

## 端到端自检(可选)

设置环境变量 `DSH_DIAGNOSE=1` 后启动应用,会自动模拟托盘打开窗口、三种模式录制、区域拖拽与设置保存,并将结果写入 `diagnostic-result.json`。

## 环境说明

- 仅支持 Windows 10 及以上 x64(Electron 44 不再提供 32 位构建)
- 国内网络安装/打包时可使用镜像:
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
