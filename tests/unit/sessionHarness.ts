import { vi } from 'vitest'
import type { StartCaptureRequest, StartCaptureResult } from '@shared/types'
import {
  RecordingSessionManager,
  type CaptureWindowLike,
  type RecordingSessionDeps
} from '../../src/main/services/recordingSession'
import type { FileSink } from '../../src/main/services/fileSink'

export class FakeSink {
  readonly path: string
  bytesWritten = 0
  finalized = false
  destroyed = false

  constructor(filePath: string) {
    this.path = filePath
  }

  write(chunk: Uint8Array): void {
    if (this.destroyed) throw new Error('写入目标已关闭')
    this.bytesWritten += chunk.byteLength
  }

  async finalize(): Promise<number> {
    this.finalized = true
    return this.bytesWritten
  }

  destroy(): void {
    this.destroyed = true
  }
}

export interface SentMessage {
  channel: string
  payload: unknown
}

export interface TestContext {
  manager: RecordingSessionManager
  sent: SentMessage[]
  sink: FakeSink
  deps: RecordingSessionDeps
  window: CaptureWindowLike
}

export function createContext(overrides: Partial<RecordingSessionDeps> = {}): TestContext {
  const sent: SentMessage[] = []
  const window: CaptureWindowLike = {
    webContents: {
      send: (channel: string, payload?: unknown) => {
        sent.push({ channel, payload })
      },
      once: () => undefined,
      on: () => undefined,
      isLoading: () => false
    },
    isDestroyed: () => false,
    destroy: () => undefined
  }
  const sink = new FakeSink('C:\\tmp\\ScreenRecording_20260101_000000.mp4')

  const deps: RecordingSessionDeps = {
    settings: { get: () => ({ storageDirectory: 'C:\\tmp' }) },
    writeMarker: vi.fn(),
    clearMarker: vi.fn(),
    createSink: () => sink as unknown as FileSink,
    validateMp4: async () => ({ ok: true }),
    notifySaved: vi.fn(),
    notifyError: vi.fn(),
    setAppState: vi.fn(),
    uniqueFilePath: async () => 'C:\\tmp\\ScreenRecording_20260101_000000.mp4',
    ensureDirectory: async () => undefined,
    getPrimaryDisplay: () => ({ id: 1, width: 1920, height: 1080, scaleFactor: 1 }),
    getPrimaryScreenSourceId: async () => 'screen:0:0',
    getWindowSource: async (id) => ({ id, name: 'Test window' }),
    createCaptureWindow: () => window,
    primeDisplayMediaSource: vi.fn(),
    mimeCandidates: ['video/mp4'],
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    setPowerSaveBlocker: vi.fn(),
    ...overrides
  }

  return { manager: new RecordingSessionManager(deps), sent, sink, deps, window }
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待条件超时')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export async function startSession(
  ctx: TestContext,
  request: StartCaptureRequest = { mode: 'fullscreen' }
): Promise<{ sessionId: string; resultPromise: Promise<StartCaptureResult> }> {
  const resultPromise = ctx.manager.start(request)
  await waitFor(() => ctx.sent.length > 0)
  const payload = ctx.sent[0].payload as { sessionId: string }
  return { sessionId: payload.sessionId, resultPromise }
}
