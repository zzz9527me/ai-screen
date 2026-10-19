export const OWN_WINDOW_PREFIX = '[SR]'

export type CaptureMode = 'fullscreen' | 'region' | 'window'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  version: 1
  storageDirectory: string
  region: Region
  lastMode: CaptureMode
  screenshotShortcut: string
  updatedAt: string
}

export interface SettingsInput {
  storageDirectory?: string
  region?: Region
  lastMode?: CaptureMode
  screenshotShortcut?: string
}

export interface WindowSource {
  id: string
  name: string
  thumbnailDataUrl: string
  appIconDataUrl: string | null
}

export type StartCaptureRequest =
  | { mode: 'fullscreen' }
  | { mode: 'region'; region: Region }
  | { mode: 'window'; windowSourceId: string; windowName: string }

export type AppState = 'idle' | 'starting' | 'recording' | 'finalizing'

export type StartCaptureErrorCode =
  | 'BUSY'
  | 'INVALID_TARGET'
  | 'UNSUPPORTED_MP4'
  | 'STORAGE_ERROR'
  | 'CAPTURE_FAILED'

export type StartCaptureResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: StartCaptureErrorCode; message: string }

export type StopCaptureResult =
  | { ok: true; outputPath: string; bytesWritten: number }
  | { ok: false; code: 'NOT_RECORDING' | 'FINALIZE_FAILED'; message: string; outputPath?: string }

export type SaveResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: Array<{ field: string; message: string }> }

export type PickFolderResult = { path: string } | { path: null }

export type ListWindowsResult =
  | { ok: true; sources: WindowSource[] }
  | { ok: false; message: string }

export type PickRegionResult =
  | { ok: true; rect: Region }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; message: string }

export interface PhysicalHint {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotImagePayload {
  dataUrl: string
  width: number
  height: number
  displayWidth?: number
  displayHeight?: number
}

export type ScreenshotSaveResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

export type ScreenshotCopyResult = { ok: true } | { ok: false; message: string }

export type ScreenshotPinResult = { ok: true } | { ok: false; message: string }

export interface CaptureBeginPayload {
  sessionId: string
  params: StartCaptureRequest
  physical: PhysicalHint
  mimeCandidates: string[]
}

export interface CaptureReadyPayload {
  sessionId: string
  mimeType: string
}

export interface CaptureChunkPayload {
  sessionId: string
  data: ArrayBuffer
}

export interface CaptureFinishedPayload {
  sessionId: string
  ok: boolean
  outputPath?: string
  error?: string
}

export interface SessionMarker {
  id: string
  outputPath: string
  startedAt: string
  mode: CaptureMode
}

export type Unsubscribe = () => void

export interface OverlayInternalApi {
  report(rect: Region): void
  cancel(): void
}

export interface CaptureInternalApi {
  onBegin(cb: (payload: CaptureBeginPayload) => void): Unsubscribe
  onAbort(cb: (reason: string) => void): Unsubscribe
  ready(sessionId: string, mimeType: string): void
  chunk(sessionId: string, data: ArrayBuffer): void
  finished(sessionId: string, ok: boolean, outputPath?: string, error?: string): void
}

export interface DshApi {
  settings: {
    get(): Promise<Settings>
    save(patch: SettingsInput): Promise<SaveResult>
    pickFolder(): Promise<PickFolderResult>
  }
  windows: {
    list(): Promise<ListWindowsResult>
  }
  region: {
    pick(): Promise<PickRegionResult>
  }
  capture: {
    start(request: StartCaptureRequest): Promise<StartCaptureResult>
    stop(): Promise<StopCaptureResult>
  }
  screenshot: {
    onImage(cb: (payload: ScreenshotImagePayload) => void): Unsubscribe
    save(dataUrl: string): Promise<ScreenshotSaveResult>
    copy(dataUrl: string): Promise<ScreenshotCopyResult>
    pin(dataUrl: string): Promise<ScreenshotPinResult>
  }
  dialog: {
    close(): void
  }
  events: {
    onState(cb: (state: AppState) => void): Unsubscribe
    onError(cb: (message: string) => void): Unsubscribe
    onSettingsChanged(cb: (settings: Settings) => void): Unsubscribe
  }
  internal: {
    overlay: OverlayInternalApi
    capture: CaptureInternalApi
  }
}
