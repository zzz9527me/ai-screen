import { describe, expect, it } from 'vitest'
import { createContext, startSession } from './sessionHarness'

describe('RecordingSessionManager', () => {
  it('records a fullscreen session and saves streamed chunks', async () => {
    const ctx = createContext()
    const { sessionId, resultPromise } = await startSession(ctx)

    expect(ctx.sent[0].channel).toBe('capture:begin')
    expect(ctx.deps.primeDisplayMediaSource).toHaveBeenCalledWith('screen:0:0')

    ctx.manager.onReady({ sessionId, mimeType: 'video/mp4' })
    expect(await resultPromise).toEqual({ ok: true, sessionId })

    ctx.manager.onChunk({ sessionId, data: new Uint8Array([1, 2, 3, 4]).buffer })
    expect(ctx.sink.bytesWritten).toBe(4)

    const stopPromise = ctx.manager.stop()
    ctx.manager.onFinished({ sessionId, ok: true })
    const stopped = await stopPromise
    expect(stopped.ok).toBe(true)
    if (stopped.ok) {
      expect(stopped.outputPath).toBe('C:\\tmp\\ScreenRecording_20260101_000000.mp4')
      expect(stopped.bytesWritten).toBe(4)
    }
    expect(ctx.sink.finalized).toBe(true)
    expect(ctx.deps.notifySaved).toHaveBeenCalledTimes(1)
    expect(ctx.deps.clearMarker).toHaveBeenCalled()
    expect(ctx.manager.getState()).toBe('idle')
  })

  it('rejects a second concurrent session with BUSY', async () => {
    const ctx = createContext()
    const { sessionId, resultPromise } = await startSession(ctx)
    ctx.manager.onReady({ sessionId, mimeType: 'video/mp4' })
    await resultPromise

    const second = await ctx.manager.start({ mode: 'fullscreen' })
    expect(second).toEqual({ ok: false, code: 'BUSY', message: '已有录制任务进行中' })

    const stopPromise = ctx.manager.stop()
    ctx.manager.onFinished({ sessionId, ok: true })
    await stopPromise
  })

  it('fails with UNSUPPORTED_MP4 when no mime is reported', async () => {
    const ctx = createContext()
    const { sessionId, resultPromise } = await startSession(ctx)
    ctx.manager.onReady({ sessionId, mimeType: '' })

    const result = await resultPromise
    expect(result).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MP4',
      message: '当前环境不支持 MP4 录制'
    })
    expect(ctx.sink.destroyed).toBe(true)
    expect(ctx.manager.getState()).toBe('idle')
  })

  it('reports FINALIZE_FAILED when mp4 validation fails', async () => {
    const ctx = createContext({
      validateMp4: async () => ({ ok: false, reason: '缺少 ftyp' })
    })
    const { sessionId, resultPromise } = await startSession(ctx)
    ctx.manager.onReady({ sessionId, mimeType: 'video/mp4' })
    await resultPromise

    const stopPromise = ctx.manager.stop()
    ctx.manager.onFinished({ sessionId, ok: true })
    const result = await stopPromise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FINALIZE_FAILED')
    expect(ctx.deps.notifyError).toHaveBeenCalled()
  })
})
