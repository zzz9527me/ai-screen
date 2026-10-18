import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc-channels'
import type {
  AppState,
  CaptureBeginPayload,
  CaptureChunkPayload,
  CaptureFinishedPayload,
  CaptureReadyPayload,
  SessionMarker,
  StartCaptureErrorCode,
  StartCaptureRequest,
  StartCaptureResult,
  StopCaptureResult
} from '@shared/types'
import type { FileSink } from './fileSink'
import { patchMp4Duration } from './mp4Duration'
import { isRegionValid, toPhysical } from './regionMath'

export interface CaptureWindowLike {
  webContents: {
    send(channel: string, payload?: unknown): void
    once?(event: string, listener: (...args: unknown[]) => void): void
    on?(event: string, listener: (...args: unknown[]) => void): void
    isLoading?(): boolean
  }
  isDestroyed(): boolean
  destroy(): void
}

export interface DisplayInfo {
  id: number
  width: number
  height: number
  scaleFactor: number
}

export interface RecordingSessionDeps {
  settings: { get(): { storageDirectory: string } }
  writeMarker(marker: SessionMarker): void
  clearMarker(): void
  createSink(filePath: string): FileSink
  validateMp4(filePath: string): Promise<{ ok: boolean; reason?: string }>
  notifySaved(filePath: string): void
  notifyError(message: string): void
  setAppState(state: AppState): void
  uniqueFilePath(directory: string, date: Date): Promise<string>
  ensureDirectory(directory: string): Promise<void>
  getPrimaryDisplay(): DisplayInfo
  getPrimaryScreenSourceId(): Promise<string | undefined>
  getWindowSource(id: string): Promise<{ id: string; name: string } | undefined>
  createCaptureWindow(): CaptureWindowLike
  primeDisplayMediaSource(sourceId: string): void
  mimeCandidates: string[]
  now(): Date
  setPowerSaveBlocker(active: boolean): void
  readyTimeoutMs?: number
  stopTimeoutMs?: number
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  readonly settled: boolean
}

function deferred<T>(): Deferred<T> {
  let resolveImpl: (value: T) => void = () => {}
  let settled = false
  const promise = new Promise<T>((resolve) => {
    resolveImpl = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }
  })
  return {
    promise,
    resolve: (value: T) => resolveImpl(value),
    get settled() {
      return settled
    }
  }
}

type ReadyOutcome = { ok: true } | { ok: false; code: StartCaptureErrorCode; error: string }

interface ActiveSession {
  id: string
  outputPath: string
  sink: FileSink
  ready: Deferred<ReadyOutcome>
  finished: Deferred<StopCaptureResult>
}

class StartFailure extends Error {
  constructor(
    readonly code: StartCaptureErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'StartFailure'
  }
}

interface ResolvedTarget {
  sourceId: string
  physical: { x: number; y: number; width: number; height: number }
}

/**
 * Owns the single recording session: target resolution, storage validation,
 * capture-window lifecycle, chunk writing, finalization and crash-marker
 * bookkeeping. Dependencies are injected so the state machine is unit-testable
 * without Electron.
 */
export class RecordingSessionManager {
  private state: AppState = 'idle'
  private active: ActiveSession | null = null
  private captureWindow: CaptureWindowLike | null = null
  private readonly readyTimeoutMs: number
  private readonly stopTimeoutMs: number

  constructor(private readonly deps: RecordingSessionDeps) {
    this.readyTimeoutMs = deps.readyTimeoutMs ?? 15000
    this.stopTimeoutMs = deps.stopTimeoutMs ?? 15000
  }

  getState(): AppState {
    return this.state
  }

  isActive(): boolean {
    return this.state !== 'idle'
  }

  async start(request: StartCaptureRequest): Promise<StartCaptureResult> {
    if (this.state !== 'idle') {
      return { ok: false, code: 'BUSY', message: '已有录制任务进行中' }
    }
    this.setState('starting')

    let sink: FileSink | null = null
    let window: CaptureWindowLike | null = null

    try {
      const settings = this.deps.settings.get()
      let outputPath: string
      try {
        await this.deps.ensureDirectory(settings.storageDirectory)
        outputPath = await this.deps.uniqueFilePath(settings.storageDirectory, this.deps.now())
      } catch (error) {
        throw new StartFailure(
          'STORAGE_ERROR',
          `存储目录不可用: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      const target = await this.resolveTarget(request)
      if ('error' in target) throw new StartFailure(target.code, target.error)

      try {
        sink = this.deps.createSink(outputPath)
      } catch (error) {
        throw new StartFailure(
          'STORAGE_ERROR',
          `无法创建录制文件: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      const active: ActiveSession = {
        id: randomUUID(),
        outputPath,
        sink,
        ready: deferred<ReadyOutcome>(),
        finished: deferred<StopCaptureResult>()
      }
      this.active = active
      this.deps.writeMarker({
        id: active.id,
        outputPath,
        startedAt: this.deps.now().toISOString(),
        mode: request.mode
      })

      this.deps.primeDisplayMediaSource(target.sourceId)
      window = this.deps.createCaptureWindow()
      this.captureWindow = window
      this.attachCaptureEvents(window)
      await this.waitForLoad(window)

      const payload: CaptureBeginPayload = {
        sessionId: active.id,
        params: request,
        physical: target.physical,
        mimeCandidates: this.deps.mimeCandidates
      }
      window.webContents.send(IPC.CaptureBegin, payload)
      this.deps.setPowerSaveBlocker(true)

      const outcome = await this.withTimeout(active.ready.promise, this.readyTimeoutMs)
      if (outcome === 'timeout') throw new StartFailure('CAPTURE_FAILED', '捕获引擎启动超时')
      if (!outcome.ok) throw new StartFailure(outcome.code, outcome.error)

      this.setState('recording')
      return { ok: true, sessionId: active.id }
    } catch (error) {
      const failure =
        error instanceof StartFailure
          ? error
          : new StartFailure(
              'CAPTURE_FAILED',
              error instanceof Error ? error.message : String(error)
            )
      await this.failStart(sink, window, failure)
      return { ok: false, code: failure.code, message: failure.message }
    }
  }

  async stop(): Promise<StopCaptureResult> {
    const active = this.active
    if (process.env.DSH_DIAGNOSE === '1') {
      console.error('[diag] session.stop enter', { state: this.state, hasActive: Boolean(active) })
    }
    if (!active || this.state !== 'recording') {
      return { ok: false, code: 'NOT_RECORDING', message: '当前没有正在进行的录制' }
    }
    this.setState('finalizing')
    this.sendToCapture(IPC.CaptureAbort, { sessionId: active.id, reason: 'stop' })
    if (process.env.DSH_DIAGNOSE === '1') {
      console.error('[diag] session.stop abort sent', active.id)
    }

    const result = await this.withTimeout(active.finished.promise, this.stopTimeoutMs)
    if (process.env.DSH_DIAGNOSE === '1') {
      console.error('[diag] session.stop awaited', result === 'timeout' ? 'timeout' : result)
    }
    if (result === 'timeout') {
      await this.handleFinished(
        { sessionId: active.id, ok: false, error: '停止录制超时,文件可能不完整' },
        true
      )
      return {
        ok: false,
        code: 'FINALIZE_FAILED',
        message: '停止录制超时',
        outputPath: active.outputPath
      }
    }
    return result
  }

  onReady(payload: CaptureReadyPayload): void {
    const active = this.active
    if (!active || payload.sessionId !== active.id) return
    if (!payload.mimeType) {
      active.ready.resolve({
        ok: false,
        code: 'UNSUPPORTED_MP4',
        error: '当前环境不支持 MP4 录制'
      })
      return
    }
    active.ready.resolve({ ok: true })
  }

  onChunk(payload: CaptureChunkPayload): void {
    const active = this.active
    const accepting = this.state === 'recording' || this.state === 'finalizing'
    if (!active || payload.sessionId !== active.id || !accepting) {
      if (process.env.DSH_DIAGNOSE === '1') {
        console.error('[diag] chunk dropped', {
          hasActive: Boolean(active),
          sessionMatches: active ? payload.sessionId === active.id : false,
          state: this.state,
          bytes: payload.data.byteLength
        })
      }
      return
    }
    try {
      active.sink.write(Buffer.from(payload.data))
      if (process.env.DSH_DIAGNOSE === '1') {
        console.error('[diag] chunk written', payload.data.byteLength, 'total', active.sink.bytesWritten)
      }
    } catch (error) {
      void this.handleFinished({
        sessionId: active.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  onFinished(payload: CaptureFinishedPayload): Promise<void> {
    return this.handleFinished(payload)
  }

  dispose(): void {
    const active = this.active
    this.active = null
    try {
      active?.sink.destroy()
    } catch {
      // ignore
    }
    this.destroyCaptureWindow()
    this.deps.clearMarker()
    this.deps.setPowerSaveBlocker(false)
    if (this.state !== 'idle') this.setState('idle')
  }

  private async resolveTarget(
    request: StartCaptureRequest
  ): Promise<ResolvedTarget | { code: StartCaptureErrorCode; error: string }> {
    if (request.mode === 'fullscreen') {
      const sourceId = await this.deps.getPrimaryScreenSourceId()
      if (!sourceId) return { code: 'INVALID_TARGET', error: '未找到主显示器捕获源' }
      const display = this.deps.getPrimaryDisplay()
      return {
        sourceId,
        physical: {
          x: 0,
          y: 0,
          width: Math.round(display.width * display.scaleFactor),
          height: Math.round(display.height * display.scaleFactor)
        }
      }
    }

    if (request.mode === 'region') {
      const display = this.deps.getPrimaryDisplay()
      if (!isRegionValid(request.region, { width: display.width, height: display.height })) {
        return { code: 'INVALID_TARGET', error: '区域无效:需不小于 16×16 DIP 且位于主显示器内' }
      }
      const sourceId = await this.deps.getPrimaryScreenSourceId()
      if (!sourceId) return { code: 'INVALID_TARGET', error: '未找到主显示器捕获源' }
      return { sourceId, physical: toPhysical(request.region, display.scaleFactor) }
    }

    const source = await this.deps.getWindowSource(request.windowSourceId)
    if (!source) {
      return { code: 'INVALID_TARGET', error: '目标窗口已关闭,请刷新窗口列表' }
    }
    return { sourceId: source.id, physical: { x: 0, y: 0, width: 0, height: 0 } }
  }

  private async failStart(
    sink: FileSink | null,
    window: CaptureWindowLike | null,
    failure: StartFailure
  ): Promise<void> {
    const active = this.active
    this.active = null
    if (active) {
      active.ready.resolve({ ok: false, code: failure.code, error: failure.message })
      active.finished.resolve({
        ok: false,
        code: 'FINALIZE_FAILED',
        message: failure.message,
        outputPath: active.outputPath
      })
    }
    try {
      sink?.destroy()
    } catch {
      // ignore
    }
    this.deps.clearMarker()
    this.destroyCaptureWindow(window)
    this.deps.setPowerSaveBlocker(false)
    this.setState('idle')
  }

  private async handleFinished(payload: CaptureFinishedPayload, force = false): Promise<void> {
    if (process.env.DSH_DIAGNOSE === '1') {
      console.error('[diag] handleFinished enter', payload, 'force', force)
    }
    const active = this.active
    if (!active) return
    if (!force && payload.sessionId !== active.id) return
    if (this.state !== 'finalizing') this.setState('finalizing')

    const { sink, outputPath, ready, finished } = active
    this.active = null
    if (!ready.settled) {
      ready.resolve({
        ok: false,
        code: 'CAPTURE_FAILED',
        error: payload.error ?? '录制失败'
      })
    }

    try {
      const bytesWritten = await sink.finalize()
      if (process.env.DSH_DIAGNOSE === '1') {
        console.error('[diag] sink finalized', bytesWritten)
      }
      try {
        const duration = await patchMp4Duration(outputPath)
        if (process.env.DSH_DIAGNOSE === '1') {
          console.error('[diag] duration patched', duration)
        }
      } catch (error) {
        if (process.env.DSH_DIAGNOSE === '1') {
          console.error('[diag] duration patch failed', error)
        }
      }
      if (payload.ok) {
        const check = await this.deps.validateMp4(outputPath)
        if (check.ok) {
          this.deps.notifySaved(outputPath)
          finished.resolve({ ok: true, outputPath, bytesWritten })
        } else {
          const message = `录制文件可能不完整: ${check.reason ?? '校验失败'}`
          this.deps.notifyError(message)
          finished.resolve({ ok: false, code: 'FINALIZE_FAILED', message, outputPath })
        }
      } else {
        const message = payload.error ?? '录制失败'
        this.deps.notifyError(message)
        finished.resolve({ ok: false, code: 'FINALIZE_FAILED', message, outputPath })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.notifyError(`保存录制文件失败: ${message}`)
      finished.resolve({ ok: false, code: 'FINALIZE_FAILED', message, outputPath })
    } finally {
      this.deps.clearMarker()
      this.deps.setPowerSaveBlocker(false)
      this.destroyCaptureWindow()
      this.setState('idle')
    }
  }

  private attachCaptureEvents(window: CaptureWindowLike): void {
    window.webContents.on?.('render-process-gone', () => {
      if (!this.active) return
      void this.handleFinished({
        sessionId: this.active.id,
        ok: false,
        error: '捕获进程异常退出'
      })
    })
  }

  private waitForLoad(window: CaptureWindowLike): Promise<void> {
    return new Promise((resolve, reject) => {
      const wc = window.webContents
      if (!wc.once) {
        resolve()
        return
      }
      if (wc.isLoading && !wc.isLoading()) {
        resolve()
        return
      }
      wc.once('did-finish-load', () => resolve())
      wc.once('did-fail-load', () => reject(new Error('捕获页面加载失败')))
    })
  }

  private sendToCapture(channel: string, payload: unknown): void {
    const window = this.captureWindow
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  private destroyCaptureWindow(window: CaptureWindowLike | null = this.captureWindow): void {
    if (window && !window.isDestroyed()) {
      try {
        window.destroy()
      } catch {
        // ignore
      }
    }
    if (window === this.captureWindow) this.captureWindow = null
  }

  private setState(state: AppState): void {
    this.state = state
    this.deps.setAppState(state)
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ms)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
