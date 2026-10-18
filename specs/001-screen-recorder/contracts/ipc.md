# IPC Contract: 屏幕录制器 (Screen Recorder)

**Feature**: 001-screen-recorder | **Date**: 2026-10-18

Electron 桌面应用无对外网络接口,用户可见的接口是**应用窗口 UI** 与**系统托盘菜单**;内部接口为**主进程 ↔ 渲染进程 IPC** 契约。本文件冻结渲染层可调用的 API 与消息结构,主进程对每个载荷做 zod 校验。

## 1. Preload 暴露面(`contextBridge` → `window.dsh`)

```ts
interface DshApi {
  settings: {
    get(): Promise<Settings>;
    save(patch: SettingsInput): Promise<SaveResult>;
    pickFolder(): Promise<PickFolderResult>;
  };
  windows: {
    list(): Promise<ListWindowsResult>;
  };
  region: {
    pick(): Promise<PickRegionResult>;
  };
  capture: {
    start(req: StartCaptureRequest): Promise<StartCaptureResult>;
    stop(): Promise<StopCaptureResult>;
  };
  dialog: {
    close(): void;
  };
  events: {
    onState(cb: (state: AppState) => void): Unsubscribe;
    onError(cb: (msg: string) => void): Unsubscribe;
  };
}
```

## 2. 数据类型(zod 即此处定义的运行时校验)

```ts
type Region = { x: number; y: number; width: number; height: number }; // int, ≥16, 主显示器 DIP 内

type Settings = {
  version: 1;
  storageDirectory: string;            // 绝对路径
  region: Region;
  lastMode: 'fullscreen' | 'region' | 'window';
  updatedAt: string;                   // ISO 8601
};

type SettingsInput = {
  storageDirectory?: string;
  region?: Region;
  lastMode?: Settings['lastMode'];
};

type WindowSource = {
  id: string;                          // 'window:<hwnd>:<index>'
  name: string;
  thumbnailDataUrl: string;            // data:image/png;base64,...
  appIconDataUrl: string | null;
};

type StartCaptureRequest =
  | { mode: 'fullscreen' }
  | { mode: 'region'; region: Region }
  | { mode: 'window'; windowSourceId: string; windowName: string };

type AppState = 'idle' | 'starting' | 'recording' | 'finalizing';
```

## 3. invoke 通道

### `settings:get` → `Settings`
返回当前设置(无效时返回默认设置并触发重置逻辑)。

### `settings:save` (`SettingsInput`) → `SaveResult`
```ts
type SaveResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: Array<{ field: string; message: string }> };
```
校验失败(区域越界、目录非法)时返回字段级错误,UI 内联展示;不抛异常。

### `dialog:pick-folder` → `PickFolderResult`
```ts
type PickFolderResult = { path: string } | { path: null }; // null = 用户取消
```

### `sources:list-windows` → `ListWindowsResult`
```ts
type ListWindowsResult = { ok: true; sources: WindowSource[] };
```
执行过滤(自身窗口、空标题、系统壳窗口);失败时 `{ ok:false; message }`。

### `region:select` → `PickRegionResult`
主进程打开透明覆盖层窗口并等待选择:
```ts
type PickRegionResult = { ok: true; rect: Region } | { ok: false; cancelled: true } | { ok: false; message: string };
```
覆盖层内部通过 `region:selected` / `region:cancelled` 回传,主进程据此 resolve。

### `capture:start` (`StartCaptureRequest`) → `StartCaptureResult`
```ts
type StartCaptureResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'BUSY' | 'INVALID_TARGET' | 'UNSUPPORTED_MP4' | 'STORAGE_ERROR' | 'CAPTURE_FAILED'; message: string };
```
主进程校验:无进行中会话(`BUSY`)、MP4 能力(由捕获渲染进程在 `capture:ready` 上报 mimeType,主进程判定 `UNSUPPORTED_MP4`)、存储目录可写(`STORAGE_ERROR`)、目标源有效(`INVALID_TARGET`)。

### `capture:stop` → `StopCaptureResult`
```ts
type StopCaptureResult =
  | { ok: true; outputPath: string; bytesWritten: number }
  | { ok: false; code: 'NOT_RECORDING' | 'FINALIZE_FAILED'; message: string; outputPath?: string };
```

## 4. send 通道(渲染 → 主进程,无返回值)

| 通道 | 载荷 | 发送方 | 用途 |
| --- | --- | --- | --- |
| `capture:ready` | `{ sessionId, mimeType: string }` | 捕获渲染进程 | 媒体管线就绪并上报探测到的 MP4 mimeType;主进程据此校验,缺失或不支持时以 `UNSUPPORTED_MP4` 失败 |
| `capture:chunk` | `{ sessionId, data: ArrayBuffer }` | 捕获渲染进程 | 录制数据块(约 1 秒/块),主进程追加写盘 |
| `capture:finished` | `{ sessionId; ok: boolean; outputPath?: string; error?: string }` | 捕获渲染进程 | 停止与封装完成/失败 |
| `region:selected` | `{ rect: Region }` | 覆盖层 | 用户完成框选 |
| `region:cancelled` | `{}` | 覆盖层 | 用户取消/Esc |

约束:`capture:chunk` 的 `data` 以 `ArrayBuffer` 传递(结构化克隆),单块尺寸上限 32 MB;超过即视为协议错误,会话失败。

## 5. 主进程 → 渲染进程(webContents.send)

| 通道 | 载荷 | 接收方 | 用途 |
| --- | --- | --- | --- |
| `capture:begin` | `{ sessionId, params: StartCaptureRequest, physical: { width: number; height: number }, mimeCandidates: string[] }` | 捕获渲染进程 | 开始捕获与编码;含输出物理尺寸与可尝试的 MP4 mime 候选列表 |
| `capture:abort` | `{ sessionId, reason: string }` | 捕获渲染进程 | 主进程中止(退出/错误) |
| `state:changed` | `{ state: AppState }` | 模式窗口/设置窗口 | 托盘与 UI 状态同步 |
| `toast:error` | `{ message: string }` | 当前 UI 窗口 | 非阻塞错误提示 |
| `settings:changed` | `{ settings: Settings }` | 模式窗口 | 设置保存后同步 |

## 6. 窗口与页面

| 页面 | 用途 | 允许调用 |
| --- | --- | --- |
| `mode.html` | 模式选择 + 区域编辑器 + 窗口列表 | settings.get、settings.onChanged、windows.list、region.select、capture.start、dialog.close、events.onState/onError |
| `settings.html` | 设置表单(区域数值、存储位置) | settings.get/save、dialog.pickFolder、events.onError |
| `overlay.html` | 透明框选覆盖层 | region:selected / region:cancelled(send) |
| `capture.html` | 隐藏媒体引擎(无 UI) | capture:ready/chunk/finished(send);capture:begin/abort(接收) |

## 7. 安全与校验约束

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`(全部渲染窗口)。
- 主进程注册 `ipcMain.handle`/`on` 时,统一做 zod 解析;解析失败返回错误,不进入业务逻辑。
- 校验 `event.sender.id` 在允许的窗口 id 列表内;窗口销毁后对应 id 立即从列表移除。
- 禁止 `webContents` 导航与新窗口:`will-navigate` / `setWindowOpenHandler` 拦截。
- CSP: `default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'`。
- 单实例锁:第二实例启动时聚焦已有实例的「录屏」入口,不创建新的录制会话(spec FR-013)。
