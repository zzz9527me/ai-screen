import { useEffect, useRef, useState } from 'react'
import type { ScreenshotImagePayload } from '@shared/types'
import { Button } from '../../common/components'

interface Point {
  x: number
  y: number
}

type Annotation =
  | { kind: 'arrow'; start: Point; end: Point }
  | { kind: 'text'; x: number; y: number; text: string }

type Tool = 'arrow' | 'text'

function arrowLineWidth(imageWidth: number): number {
  return Math.max(2.5, imageWidth / 500)
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  imageWidth: number
): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 2) return
  const lineWidth = arrowLineWidth(imageWidth)
  const headLength = Math.max(12, lineWidth * 5)
  const angle = Math.atan2(dy, dx)
  context.strokeStyle = '#ff453a'
  context.fillStyle = '#ff453a'
  context.lineWidth = lineWidth
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(
    end.x - Math.cos(angle) * headLength * 0.55,
    end.y - Math.sin(angle) * headLength * 0.55
  )
  context.stroke()
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - Math.cos(angle - Math.PI / 7) * headLength,
    end.y - Math.sin(angle - Math.PI / 7) * headLength
  )
  context.lineTo(
    end.x - Math.cos(angle + Math.PI / 7) * headLength,
    end.y - Math.sin(angle + Math.PI / 7) * headLength
  )
  context.closePath()
  context.fill()
}

function drawTextAnnotation(
  context: CanvasRenderingContext2D,
  note: Extract<Annotation, { kind: 'text' }>,
  imageWidth: number
): void {
  const fontSize = Math.max(20, imageWidth / 40)
  context.font = `600 ${fontSize}px "Microsoft YaHei UI", "Segoe UI", sans-serif`
  context.textBaseline = 'top'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(3, fontSize / 8)
  context.strokeStyle = 'rgba(0, 0, 0, 0.72)'
  context.strokeText(note.text, note.x, note.y)
  context.fillStyle = '#ff453a'
  context.fillText(note.text, note.x, note.y)
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  imageWidth: number
): void {
  if (annotation.kind === 'arrow') {
    drawArrow(context, annotation.start, annotation.end, imageWidth)
    return
  }
  drawTextAnnotation(context, annotation, imageWidth)
}

export function App(): React.JSX.Element {
  const [image, setImage] = useState<ScreenshotImagePayload | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragEnd, setDragEnd] = useState<Point | null>(null)
  const [display, setDisplay] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const draftRef = useRef<HTMLInputElement>(null)
  const draftCommittedRef = useRef(false)

  useEffect(() => window.dsh.screenshot.onImage((payload) => setImage(payload)), [])

  useEffect(() => {
    if (!image) return
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => {
      const availableWidth = Math.max(1, stage.clientWidth - 32)
      const availableHeight = Math.max(1, stage.clientHeight - 32)
      const scale = Math.min(availableWidth / image.width, availableHeight / image.height, 1)
      setDisplay({
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale))
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [image])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (const annotation of annotations) drawAnnotation(context, annotation, image.width)
    if (dragStart && dragEnd) drawArrow(context, dragStart, dragEnd, image.width)
  }, [annotations, dragStart, dragEnd, image])

  useEffect(() => {
    if (!draft) return
    draftRef.current?.focus()
    draftRef.current?.select()
  }, [draft])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !draft) window.dsh.dialog.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [draft])

  const toNatural = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    const current = image as ScreenshotImagePayload
    return {
      x: ((event.clientX - rect.left) / rect.width) * current.width,
      y: ((event.clientY - rect.top) / rect.height) * current.height
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!image) return
    if (tool === 'text') {
      const point = toNatural(event)
      draftCommittedRef.current = false
      setDraft({ x: point.x, y: point.y })
      return
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic events used by diagnostics have no active pointer; drawing still works.
    }
    const point = toNatural(event)
    setDragStart(point)
    setDragEnd(point)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragStart) return
    setDragEnd(toNatural(event))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragStart) return
    const end = toNatural(event)
    const distance = Math.hypot(end.x - dragStart.x, end.y - dragStart.y)
    if (distance > 4) {
      setAnnotations((current) => [...current, { kind: 'arrow', start: dragStart, end }])
    }
    setDragStart(null)
    setDragEnd(null)
  }

  const commitDraft = (): void => {
    if (!draft || draftCommittedRef.current) return
    draftCommittedRef.current = true
    const text = draftRef.current?.value.trim() ?? ''
    if (text) {
      setAnnotations((current) => [
        ...current,
        { kind: 'text', x: draft.x, y: draft.y, text }
      ])
    }
    setDraft(null)
  }

  const compose = (): string | null => {
    const source = imageRef.current
    const current = image
    if (!source || !current || !loaded) return null
    const canvas = document.createElement('canvas')
    canvas.width = current.width
    canvas.height = current.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(source, 0, 0, current.width, current.height)
    const draftText = draft ? (draftRef.current?.value.trim() ?? '') : ''
    const pending =
      draft && draftText
        ? [...annotations, { kind: 'text' as const, x: draft.x, y: draft.y, text: draftText }]
        : annotations
    for (const annotation of pending) drawAnnotation(context, annotation, current.width)
    return canvas.toDataURL('image/png')
  }

  const showToast = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3500)
  }

  const save = async (): Promise<void> => {
    setError(null)
    const dataUrl = compose()
    if (!dataUrl) {
      setError('图片尚未加载完成')
      return
    }
    setBusy(true)
    try {
      const result = await window.dsh.screenshot.save(dataUrl)
      if (result.ok) showToast(`已保存: ${result.path}`)
      else setError(result.message)
    } catch (cause) {
      setError(`保存失败: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    setError(null)
    const dataUrl = compose()
    if (!dataUrl) {
      setError('图片尚未加载完成')
      return
    }
    setBusy(true)
    try {
      const result = await window.dsh.screenshot.copy(dataUrl)
      if (result.ok) showToast('已复制到剪贴板')
      else setError(result.message)
    } catch (cause) {
      setError(`复制失败: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const draftFontSize =
    image && display.width > 0
      ? Math.max(14, Math.min(32, (image.width / 40) * (display.width / image.width)))
      : 16

  return (
    <div className="screenshot-app">
      <div className="screenshot-stage" ref={stageRef}>
        {!image && <div className="screenshot-empty">正在准备截图…</div>}
        {image && (
          <div
            className="screenshot-image-shell"
            style={{ width: display.width, height: display.height }}
          >
            <img
              ref={imageRef}
              src={image.dataUrl}
              alt="屏幕截图"
              draggable={false}
              onLoad={() => setLoaded(true)}
            />
            <canvas
              ref={canvasRef}
              aria-label="截图标注画布"
              style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                setDragStart(null)
                setDragEnd(null)
              }}
            />
            {draft && (
              <input
                ref={draftRef}
                className="screenshot-text-input"
                style={{
                  left: `${Math.min(
                    Math.max(0, (draft.x / (image?.width ?? 1)) * display.width),
                    Math.max(0, display.width - 180)
                  )}px`,
                  top: `${Math.min(
                    Math.max(0, (draft.y / (image?.height ?? 1)) * display.height),
                    Math.max(0, display.height - 36)
                  )}px`,
                  fontSize: `${draftFontSize}px`,
                  zIndex: 5
                }}
                defaultValue=""
                placeholder="输入文字…"
                aria-label="文字标注"
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    draftCommittedRef.current = true
                    setDraft(null)
                  }
                }}
                onBlur={commitDraft}
              />
            )}
          </div>
        )}
        {toast && <div className="screenshot-toast">{toast}</div>}
      </div>

      <div className="screenshot-toolbar">
        <div className="screenshot-tools">
          <Button
            className={tool === 'arrow' ? 'tool-active' : ''}
            aria-pressed={tool === 'arrow'}
            onClick={() => setTool('arrow')}
            title="拖动鼠标绘制箭头"
          >
            箭头
          </Button>
          <Button
            className={tool === 'text' ? 'tool-active' : ''}
            aria-pressed={tool === 'text'}
            onClick={() => setTool('text')}
            title="点击图片输入文字"
          >
            文本
          </Button>
          <span className="screenshot-hint">
            {tool === 'arrow' ? '按住拖动绘制箭头' : '点击图片放置文字'}
          </span>
        </div>
        <div className="screenshot-actions">
          {error && <span className="screenshot-error">{error}</span>}
          <Button onClick={() => window.dsh.dialog.close()}>关闭</Button>
          <Button onClick={() => void copy()} disabled={busy || !loaded}>
            复制图片
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !loaded}>
            {busy ? '处理中…' : '保存图片'}
          </Button>
        </div>
      </div>
    </div>
  )
}
