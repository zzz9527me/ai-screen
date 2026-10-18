# Data Model: 屏幕录制器 (Screen Recorder)

**Feature**: 001-screen-recorder | **Date**: 2026-10-18

本文件定义功能涉及的数据实体、字段、校验规则与状态迁移。字段均为实现无关的业务描述(zod schema 见 `src/shared/schemas.ts` 的设计)。

## 1. Settings(持久化配置)

存放于 `userData/settings.json`,原子写入,由 zod 校验。

| 字段 | 类型 | 校验规则 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `version` | `1`(字面量) | 必须为 1;未知版本 → 备份后重置 | `1` | 数据结构版本,用于未来迁移 |
| `storageDirectory` | `string` | 绝对路径;目录可创建且可写 | `%USERPROFILE%\Videos\DSH Screen Recorder` | 录制文件输出目录(FR-015/016/017) |
| `region` | `Region`(见 §2) | 整数、`width`/`height` ≥ 16、完全位于主显示器 DIP 边界内 | `{x:0,y:0,width:1280,height:720}` 夹取到显示器范围 | 区域录制范围(FR-007) |
| `lastMode` | `'fullscreen' \| 'region' \| 'window'` | 枚举 | `'fullscreen'` | 模式选择窗口的默认选中项 |
| `updatedAt` | ISO 8601 字符串 | 合法时间戳 | 写入时自动生成 | 审计/调试用途 |

音频字段不存储:首版固定不录制音频(spec FR-014),实现中不存在音频开关。

## 2. Region(值对象,嵌入 Settings / 请求)

| 字段 | 类型 | 校验规则 | 说明 |
| --- | --- | --- | --- |
| `x` | `int` | ≥ 0,`x + width ≤ display.width` | 左上角 DIP 横坐标(主显示器坐标) |
| `y` | `int` | ≥ 0,`y + height ≤ display.height` | 左上角 DIP 纵坐标 |
| `width` | `int` | ≥ 16 | DIP 宽度 |
| `height` | `int` | ≥ 16 | DIP 高度 |

物理像素换算(录制时):`physX = Math.round(x * scaleFactor)`、`physY = Math.round(y * scaleFactor)`、`physW = Math.round(width * scaleFactor)`、`physH = Math.round(height * scaleFactor)`;结果再按显示器物理边界夹取。

## 3. WindowSource(瞬态,不持久化)

来自 `desktopCapturer.getSources({ types: ['window'] })`,经过滤后提供给模式选择窗口。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Electron 源 id(`window:<hwnd>:<index>`) |
| `name` | `string` | 窗口标题 |
| `thumbnailDataUrl` | `string` | 320×180 缩略图(data URL) |
| `appIconDataUrl` | `string \| null` | 应用图标(可选) |
| `excluded` | `boolean`(内部) | 过滤结果,不传给 UI |

过滤规则(实现约束):
- 排除标题以 `[SR]` 开头的窗口(应用自身:模式选择、设置、区域选择覆盖层);
- 排除空标题;
- 排除已知系统 shell 窗口标题(`Program Manager`、`Windows 输入体验` 等)。

## 4. CaptureMode(枚举)

`'fullscreen' | 'region' | 'window'`,对应《spec》的三种录制模式(FR-004/005/006/008)。

## 5. RecordingSession(运行时实体,状态机)

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string`(uuid) | 会话唯一标识,贯穿 IPC |
| `mode` | `CaptureMode` | 录制模式 |
| `target` | `DisplayTarget \| RegionTarget \| WindowTarget` | 捕获目标(见 §6) |
| `startedAt` | ISO 8601 | 开始时间 |
| `status` | `'starting' \| 'recording' \| 'finalizing' \| 'completed' \| 'failed'` | 状态 |
| `outputPath` | `string \| null` | 输出文件绝对路径 |
| `mimeType` | `string` | 实际使用的 MediaRecorder mimeType |
| `videoBitsPerSecond` | `number` | 实际码率 |
| `frameRate` | `30` | 固定 30fps |
| `bytesWritten` | `number` | 累计写入字节(用于磁盘空间与日志) |

### 状态迁移

```
idle → starting → recording → finalizing → completed
         │            │             └→ failed
         └→ failed    └→ failed(异常/轨结束/写盘错误)
completed/failed → idle(清理托盘与标记文件)
```

约束:
- 同一时间仅一个会话(spec FR-013):`idle` 之外拒绝新的 `capture:start`。
- `recording → finalizing` 可由三种触发:用户点击托盘「停止录制」、媒体轨 `ended`(目标窗口被关闭)、主进程中止(`capture:abort`)。
- `finalizing → completed` 条件:写流已关闭、文件存在、大小 > 1 KB 且前 8 字节含 `ftyp`;否则 `failed` 并保留已写内容。
- `completed`/`failed` 后删除 `recording-session.json` 标记。

## 6. Target(联合类型)

| 类型 | 字段 | 来源 | 对应 FR |
| --- | --- | --- | --- |
| `DisplayTarget` | `displayId: string`(DIP 主显示器 id) | `screen.getPrimaryDisplay()` 与 desktopCapturer screen 源匹配 | FR-005 |
| `RegionTarget` | `rect: Region` | 设置中的区域或覆盖层框选结果 | FR-006/007 |
| `WindowTarget` | `sourceId: string`, `windowName: string` | 模式选择窗口中的窗口列表 | FR-008 |

## 7. RecordingSessionMarker(持久化瞬态标记)

`userData/recording-session.json`,仅在一次录制进行时存在:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 会话 id |
| `outputPath` | `string` | 正在写入的文件路径 |
| `startedAt` | ISO 8601 | 开始时间 |
| `mode` | `CaptureMode` | 模式 |

启动时检测:若文件存在,说明上次会话异常终止 → 发送系统通知「上次录制可能未完成,文件: <name>」;删除标记;若对应文件存在但校验不通过,不删除文件,交由用户处理。满足章程「异常中断需明确报告损坏」要求。

## 8. FileSink(运行时资源,非实体)

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `sessionId` | `string` | 关联会话 |
| `stream` | `fs.WriteStream` | 追加写入的输出流 |
| `path` | `string` | 文件路径 |
| `bytesWritten` | `number` | 已写字节数 |

生命周期:`capture:start` 成功后创建 → `capture:chunk` 追加 → `finalizing` 时 `end()` 并等待 `finish` → 校验。

## 9. 校验规则汇总(源自 spec 需求)

| 规则 | 来源 | 行为 |
| --- | --- | --- |
| 区域必须合法(≥16×16 DIP 且位于主显示器内) | FR-007 | 设置保存时拒绝并返回字段错误;框选确认时同样校验 |
| 存储目录必须可写 | FR-015/017 | 开始录制前 `mkdir -p` + 写探针;失败 → 明确错误,不启动录制 |
| 文件名唯一 | FR-011 | `ScreenRecording_YYYYMMDD_HHmmss.mp4`,冲突时追加 `_1`、`_2`… |
| 单会话 | FR-013 | 会话状态机 + 托盘菜单禁用重复入口 |
| 无音频 | FR-014 | 捕获约束仅 `video`,MP4 不包含音轨 |
| 失败必须提示 | FR-012 | 错误对话框/通知;保留已写文件并报告 |
| 进程崩溃 | 章程/Edge Cases | 残留标记 → 启动时通知;不静默删除文件 |

## 10. 术语表

- **DIP**:设备无关像素(Electron `screen` API 使用的坐标单位)。
- **物理像素**:显示器实际像素,录制输出尺寸;`物理 = DIP × scaleFactor`。
- **finalizing**:从停止指令到文件关闭并校验完成的过渡状态。
- **ftyp 检查**:MP4 文件头 `ftyp` box 探测,用于识别明显损坏/未封装完成的文件。
