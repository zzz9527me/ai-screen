import { pickSupportedMime } from '@shared/mime'
import type { CaptureBeginPayload } from '@shared/types'

let recorder: MediaRecorder | null = null
let drawTimer: number | null = null
let sessionId = ''
let finished = false
let stream: MediaStream | null = null
let pendingChunks: Array<Promise<void>> = []
let dataChunks = 0
let firstData: Promise<void> = Promise.resolve()
let resolveFirstData: (() => void) | null = null
let drawCount = 0

function resetFirstData(): void {
  firstData = new Promise<void>((resolve) => {
    resolveFirstData = resolve
  })
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function cleanup(): void {
  if (drawTimer !== null) {
    window.clearInterval(drawTimer)
    drawTimer = null
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
}

function reportFinished(ok: boolean, error?: string): void {
  if (finished) return
  finished = true
  cleanup()
  window.dsh.internal.capture.finished(sessionId, ok, undefined, error)
}

function stopRecorder(): void {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop()
    return
  }
  reportFinished(true)
}

async function begin(payload: CaptureBeginPayload): Promise<void> {
  sessionId = payload.sessionId
  finished = false
  pendingChunks = []
  dataChunks = 0
  drawCount = 0
  resetFirstData()
  console.log('[capture] begin', payload.params.mode, payload.physical)

  try {
    const mime = pickSupportedMime((candidate) => MediaRecorder.isTypeSupported(candidate))
    if (!mime) {
      console.log('[capture] no supported mime')
      reportFinished(false, 'UNSUPPORTED_MP4')
      return
    }
    console.log('[capture] mime', mime)

    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    })
    console.log('[capture] stream', stream.getVideoTracks()[0]?.getSettings())

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('无法读取捕获流'))
    })
    await video.play().catch(() => undefined)
    console.log('[capture] video state', video.readyState, 'paused', video.paused)

    let width = payload.physical.width
    let height = payload.physical.height
    if (payload.params.mode === 'window' || width <= 0 || height <= 0) {
      width = video.videoWidth
      height = video.videoHeight
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(16, Math.round(width))
    canvas.height = Math.max(16, Math.round(height))
    console.log('[capture] canvas', canvas.width, canvas.height, 'video', video.videoWidth, video.videoHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建画布上下文')

    const draw = (): void => {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
      if (payload.params.mode === 'region') {
        const sourceX = Math.max(0, Math.min(payload.physical.x, video.videoWidth - 1))
        const sourceY = Math.max(0, Math.min(payload.physical.y, video.videoHeight - 1))
        const sourceWidth = Math.min(payload.physical.width, video.videoWidth - sourceX)
        const sourceHeight = Math.min(payload.physical.height, video.videoHeight - sourceY)
        if (sourceWidth <= 0 || sourceHeight <= 0) return
        context.drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height
        )
        drawCount += 1
        if (drawCount === 1 || drawCount % 30 === 0) console.log('[capture] draw', drawCount)
        return
      }
      context.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        0,
        0,
        canvas.width,
        canvas.height
      )
      drawCount += 1
      if (drawCount === 1 || drawCount % 30 === 0) console.log('[capture] draw', drawCount)
    }
    drawTimer = window.setInterval(draw, 1000 / 30)
    draw()
    console.log('[capture] first draw done')

    const canvasStream = canvas.captureStream(30)
    const bitsPerSecond = Math.min(
      20_000_000,
      Math.max(4_000_000, Math.round(canvas.width * canvas.height * 3))
    )
    recorder = new MediaRecorder(canvasStream, {
      mimeType: mime,
      videoBitsPerSecond: bitsPerSecond
    })

    recorder.ondataavailable = (event: BlobEvent) => {
      console.log('[capture] dataavailable', event.data?.size ?? -1)
      if (!event.data || event.data.size === 0) return
      dataChunks += 1
      resolveFirstData?.()
      resolveFirstData = null
      pendingChunks.push(
        event.data.arrayBuffer().then((buffer) => {
          console.log('[capture] chunk', buffer.byteLength)
          window.dsh.internal.capture.chunk(sessionId, buffer)
        })
      )
    }
    recorder.onstop = () => {
      console.log('[capture] onstop')
      void Promise.allSettled(pendingChunks).then(() => reportFinished(true))
    }
    recorder.onerror = () => {
      console.log('[capture] recorder error')
      reportFinished(false, '录制编码失败')
    }
    recorder.start(1000)
    console.log('[capture] recorder started', recorder.state)

    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopRecorder())

    window.dsh.internal.capture.ready(sessionId, mime)
  } catch (error) {
    reportFinished(false, error instanceof Error ? error.message : String(error))
  }
}

async function handleAbort(): Promise<void> {
  if (!recorder || recorder.state === 'inactive') {
    reportFinished(true)
    return
  }
  console.log('[capture] abort', { draws: drawCount, dataChunks })
  if (dataChunks === 0) {
    try {
      recorder.requestData()
    } catch {
      // ignore; stop below will flush whatever exists
    }
    await Promise.race([firstData, wait(2000)])
    console.log('[capture] post-wait', { draws: drawCount, dataChunks })
  }
  stopRecorder()
}

window.dsh.internal.capture.onBegin((payload) => {
  void begin(payload)
})
window.dsh.internal.capture.onAbort(() => {
  void handleAbort()
})
