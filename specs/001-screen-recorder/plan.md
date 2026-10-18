# Implementation Plan: 屏幕录制器 (Screen Recorder)

**Branch**: `001-screen-recorder` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-screen-recorder/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

在 Windows 10+ 上交付托盘常驻的屏幕录制桌面应用:支持全屏(主显示器)、选定区域、指定应用窗口三种录制模式,停止后输出无音轨的 H.264 MP4 文件;提供设置界面配置区域范围与存储位置并持久化。技术路线:Electron 44.9.0(Chromium 152)+ TypeScript 5.9.3 + electron-vite 6 + React 19;捕获走 `getDisplayMedia` + `setDisplayMediaRequestHandler`;渲染层用 canvas 统一合成(裁剪/缩放)后交给 `MediaRecorder` 直接输出 `video/mp4`,并保留 WebCodecs + mediabunny 的兜底;数据块流式写入磁盘;electron-builder 产出 NSIS 安装包与 portable(x64)。

详细决策见 [research.md](./research.md),实体与状态机见 [data-model.md](./data-model.md),IPC 契约见 [contracts/ipc.md](./contracts/ipc.md),验收步骤见 [quickstart.md](./quickstart.md)。

## Technical Context

**Language/Version**: TypeScript `5.9.3`;运行时 Node.js `24.18.1`(Electron 44 内置);ES2023 目标

**Primary Dependencies**:
- `electron@44.9.0`(Chromium `152.0.7977.54`、V8 15.2;64 位 x64/arm64)
- `electron-vite@6.0.0` + `vite@8.3.4`(构建/开发服务器)
- `react@19.3.1`(模式选择窗口、设置窗口、覆盖层 UI)
- `zod@4.6.7`(设置与 IPC 载荷校验)
- `electron-builder@26.15.3`(打包:NSIS + portable)
- `mediabunny@1.61.6`(MP4 复用器兜底;仅在 MediaRecorder MP4 不可用时启用)
- `vitest@5.0.5`(单元测试)、`@playwright/test@1.64.1`(可选 Electron 冒烟)
- `typescript-eslint@8.71.2` + ESLint 10.x + Prettier(代码质量)

**Storage**: `userData/settings.json`(zod 校验、原子写入);录制 MP4 流式写入用户配置目录;`userData/recording-session.json` 崩溃标记

**Testing**: Vitest 单测(区域 DPI 换算、settings schema、文件名、mime 探测、ftyp 检查、窗口过滤、会话状态机);Playwright 冒烟(可选);人工验收见 quickstart

**Target Platform**: Windows 10 1809+ / Windows 11,x64(Electron 44 仅提供 64 位构建)

**Project Type**: desktop-app(Electron 单项目:main / preload / renderer)

**Performance Goals**: 30 fps,1080p 输出;正常桌面操作下录屏不造成可感知卡顿(SC-008 主观 ≥4/5);停止录制后 ≤5 秒文件可播放(SC-007);CPU 目标 ≤10%(典型硬件,1080p30)

**Constraints**: MP4 输出强制、无音频(FR-014)、单录制会话(FR-013)、离线应用;渲染进程 `sandbox`+`contextIsolation`,无 `nodeIntegration`;内存有界(分块写盘);支持 ≥1 小时长录制

**Scale/Scope**: 单用户桌面应用;三种录制模式、设置界面、托盘交互;不包含暂停/恢复、水印、剪辑、云上传

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 章程门禁(constitution v1.0.0) | 计划满足方式 | 结论 |
| --- | --- | --- |
| I. 平台承诺:Windows 10 及以上 | Electron 44(Chromium 152)支持 Win10/11 x64;electron-builder 产出 NSIS + portable | ✅ PASS |
| II. 三种录制模式 | 全屏=主显示器 screen 源;区域=DIP 覆盖层框选 + canvas 物理像素裁剪;窗口=desktopCapturer window 源 + 轨 `ended` 自动停止 | ✅ PASS |
| III. MP4 输出 | MediaRecorder `video/mp4`(启动探测 avc1 mime);兜底 WebCodecs + mediabunny;`ftyp` 校验;无音轨 | ✅ PASS |
| IV. 托盘优先交互 | Tray 动态菜单(空闲:录屏/设置;录制中:停止录制);模式窗口含三模式选择与开始按钮;录制中菜单可用 | ✅ PASS |
| V. 用户可配置 | 设置窗口(区域数值 + 框选、存储位置);zod 校验;原子持久化;默认值 `Videos/DSH Screen Recorder` | ✅ PASS |
| 技术约束与质量要求 | 停止即封装并校验;区域与设置一致;Win10/Win11 验证;未定义细节走规范澄清 | ✅ PASS |
| 开发流程与质量门禁 | 按 specify→plan→tasks→implement;实现可追溯到 FR/SC;单测 + 人工验收覆盖三种模式 | ✅ PASS |

**Post-Design Re-check**: Phase 1 设计(data-model / contracts / quickstart)未引入与章程冲突的约束,门禁全部保持 PASS。

## Project Structure

### Documentation (this feature)

```text
specs/001-screen-recorder/
├── plan.md              # 本文件
├── spec.md              # 功能规范
├── research.md          # Phase 0:技术决策与调研
├── data-model.md        # Phase 1:实体、校验与状态机
├── contracts/
│   └── ipc.md           # Phase 1:IPC 契约
├── quickstart.md        # Phase 1:运行与端到端验收
├── checklists/
│   └── requirements.md  # 规范质量检查清单
└── tasks.md             # Phase 2 输出(/speckit-tasks 生成,本命令不创建)
```

### Source Code (repository root)

```text
package.json
electron.vite.config.ts          # main / preload / renderer 多入口
tsconfig.json                    # solution 配置
tsconfig.node.json               # main + preload
tsconfig.web.json                # renderer
eslint.config.js
vitest.config.ts
build/
└── icon.ico                     # 多尺寸应用/托盘图标(256/128/64/32/16)

src/
├── main/
│   ├── index.ts                 # app 生命周期、单实例锁、安全策略、会话编排
│   ├── tray.ts                  # 托盘图标与动态菜单
│   ├── windows/
│   │   ├── modeDialog.ts        # 模式选择窗口
│   │   ├── settingsWindow.ts    # 设置窗口
│   │   ├── regionOverlay.ts     # 透明框选覆盖层
│   │   ├── captureWindow.ts     # 隐藏捕获渲染进程
│   │   └── windowFactory.ts     # 安全窗口工厂([SR] 标题前缀、沙箱/CSP)
│   ├── ipc/
│   │   └── handlers.ts          # 全通道注册与 zod 校验、发送方校验
│   └── services/
│       ├── settingsStore.ts     # 读取/校验/原子写入/默认值
│       ├── captureSources.ts    # 屏幕与窗口源枚举、窗口过滤
│       ├── regionMath.ts        # DIP↔物理像素换算、边界与最小尺寸校验
│       ├── fileSink.ts          # 流式写入 MP4 数据块
│       ├── recordingSession.ts  # 会话状态机、启动/停止/失败处理
│       ├── crashRecovery.ts     # 残留标记检测与通知
│       ├── mp4Probe.ts          # ftyp 检查
│       ├── filename.ts          # 时间戳文件名与冲突去重
│       └── notifications.ts     # 保存成功/崩溃恢复系统通知
├── preload/
│   └── index.ts                 # contextBridge API(window.dsh)
├── shared/
│   ├── types.ts                 # 实体与 DTO 类型
│   ├── schemas.ts               # zod schema(settings / IPC)
│   ├── mime.ts                  # MP4 mime 候选与渲染进程探测辅助
│   └── ipc-channels.ts          # 通道常量
└── renderer/
    ├── mode/                    # 模式选择窗口(React)
    │   ├── index.html
    │   └── src/ (App.tsx、RegionEditor.tsx、WindowPicker.tsx)
    ├── settings/                # 设置窗口(React)
    │   ├── index.html
    │   └── src/ (App.tsx、表单校验)
    ├── overlay/                 # 区域框选覆盖层
    │   ├── index.html
    │   └── src/ (mask + selection)
    ├── capture/                 # 隐藏媒体引擎(无 UI)
    │   ├── index.html
    │   └── src/ (getDisplayMedia → canvas → MediaRecorder → IPC)
    └── common/                  # 共用样式/工具

tests/
├── unit/
│   ├── settingsStore.test.ts
│   ├── regionMath.test.ts
│   ├── filename.test.ts
│   ├── mime.test.ts
│   ├── mp4Probe.test.ts
│   ├── windowFilter.test.ts
│   ├── recordingSession.test.ts
│   └── recordingSession.fullscreen.test.ts
└── e2e/
    └── smoke.spec.ts            # Playwright Electron 冒烟(可选)
```

**Structure Decision**: 采用 electron-vite 单项目布局:主进程负责窗口编排、托盘、IPC、设置与写盘;捕获渲染进程只承载媒体管线(隐藏窗口、`backgroundThrottling: false`);UI 渲染进程(模式/设置/覆盖层)为薄层,经 preload 暴露的类型化 API 与主进程通信;`shared/` 集中 zod schema 与类型,供三端与单测复用。该结构避免了额外的 native 模块与多项目复杂度,同时把媒体、文件与 UI 关注点清晰分离。

## Complexity Tracking

> 无章程违规项:Constitution Check 全部通过,无需要豁免的复杂度。
