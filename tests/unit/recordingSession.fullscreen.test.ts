import { describe, expect, it, vi } from 'vitest'
import { createContext, startSession } from './sessionHarness'

describe('RecordingSessionManager targets', () => {
  it('primes the primary screen source and uses physical fullscreen size', async () => {
    const ctx = createContext()
    const { sessionId, resultPromise } = await startSession(ctx)

    const begin = ctx.sent[0].payload as {
      sessionId: string
      physical: { x: number; y: number; width: number; height: number }
      mimeCandidates: string[]
    }
    expect(begin.mimeCandidates).toEqual(['video/mp4'])
    expect(begin.physical).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(ctx.deps.primeDisplayMediaSource).toHaveBeenCalledWith('screen:0:0')

    ctx.manager.onReady({ sessionId, mimeType: 'video/mp4' })
    await resultPromise
    ctx.manager.dispose()
  })

  it('converts a DIP region to physical pixels', async () => {
    const ctx = createContext({
      getPrimaryDisplay: () => ({ id: 1, width: 1920, height: 1080, scaleFactor: 1.25 })
    })
    const { sessionId, resultPromise } = await startSession(ctx, {
      mode: 'region',
      region: { x: 10, y: 20, width: 100, height: 50 }
    })

    const begin = ctx.sent[0].payload as {
      physical: { x: number; y: number; width: number; height: number }
    }
    expect(begin.physical).toEqual({ x: 13, y: 25, width: 125, height: 63 })

    ctx.manager.onReady({ sessionId, mimeType: 'video/mp4' })
    await resultPromise
    ctx.manager.dispose()
  })

  it('rejects regions below 16x16 without creating a capture window', async () => {
    const createCaptureWindow = vi.fn()
    const ctx = createContext({ createCaptureWindow })

    const result = await ctx.manager.start({
      mode: 'region',
      region: { x: 0, y: 0, width: 10, height: 10 }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_TARGET')
    expect(createCaptureWindow).not.toHaveBeenCalled()
    expect(ctx.manager.getState()).toBe('idle')
  })

  it('rejects window targets that no longer exist', async () => {
    const ctx = createContext({ getWindowSource: async () => undefined })
    const result = await ctx.manager.start({
      mode: 'window',
      windowSourceId: 'window:9:0',
      windowName: 'Gone'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_TARGET')
    expect(ctx.manager.getState()).toBe('idle')
  })
})
