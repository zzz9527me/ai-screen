import { useEffect, useRef, useState } from 'react'
import type { ScreenshotImagePayload } from '@shared/types'

interface Point {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type Tool =
  | 'move'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'marker'
  | 'text'
  | 'mosaic'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Annotation =
  | {
      kind: 'rect' | 'ellipse' | 'line' | 'arrow'
      start: Point
      end: Point
      color: string
      width: number
    }
  | { kind: 'pen' | 'marker'; points: Point[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'mosaic'; start: Point; end: Point }

type DragState =
  | { mode: 'new'; start: Point }
  | { mode: 'move'; start: Point; origin: Rect }
  | { mode: 'resize'; handle: Handle; start: Point; origin: Rect }
  | { mode: 'draw'; start: Point; points: Point[] }

const COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#ffffff']
const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: 'move', label: '移动选区', icon: '✥' },
  { id: 'rect', label: '矩形', icon: '▭' },
  { id: 'ellipse', label: '椭圆', icon: '◯' },
  { id: 'line', label: '直线', icon: '╱' },
  { id: 'arrow', label: '箭头', icon: '↗' },
  { id: 'pen', label: '画笔', icon: '✎' },
  { id: 'marker', label: '马克笔', icon: '▤' },
  { id: 'text', label: '文字', icon: 'T' },
  { id: 'mosaic', label: '马赛克', icon: '▦' }
]
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

function strokeWidth(imageWidth: number): number {
  return Math.max(2.5, imageWidth / 500)
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  width: number
): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.hypot(dx, dy) < 2) return
  const angle = Math.atan2(dy, dx)
  const head = Math.max(14, width * 5)
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x - Math.cos(angle) * head * 0.55, end.y - Math.sin(angle) * head * 0.55)
  context.stroke()
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - Math.cos(angle - Math.PI / 7) * head,
    end.y - Math.sin(angle - Math.PI / 7) * head
  )
  context.lineTo(
    end.x - Math.cos(angle + Math.PI / 7) * head,
    end.y - Math.sin(angle + Math.PI / 7) * head
  )
  context.closePath()
  context.fill()
}

function drawMosaic(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  imageWidth: number,
  source: HTMLCanvasElement | null
): void {
  if (!source) return
  const rect = normalizeRect(start, end)
  const sx = Math.max(0, Math.round(rect.x))
  const sy = Math.max(0, Math.round(rect.y))
  const sw = Math.max(1, Math.round(rect.width))
  const sh = Math.max(1, Math.round(rect.height))
  if (sw < 2 || sh < 2) return
  const block = Math.max(8, imageWidth / 140)
  const cols = Math.max(1, Math.round(sw / block))
  const rows = Math.max(1, Math.round(sh / block))
  const temp = document.createElement('canvas')
  temp.width = cols
  temp.height = rows
  const tempContext = temp.getContext('2d')
  if (!tempContext) return
  tempContext.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows)
  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(temp, 0, 0, cols, rows, sx, sy, sw, sh)
  context.restore()
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  imageWidth: number,
  source: HTMLCanvasElement | null
): void {
  if (annotation.kind === 'mosaic') {
    drawMosaic(context, annotation.start, annotation.end, imageWidth, source)
    return
  }
  if (annotation.kind === 'text') {
    context.save()
    context.font = `600 ${annotation.size}px "Microsoft YaHei UI", "Segoe UI", sans-serif`
    context.textBaseline = 'top'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(3, annotation.size / 8)
    context.strokeStyle = 'rgba(0, 0, 0, 0.72)'
    context.strokeText(annotation.text, annotation.x, annotation.y)
    context.fillStyle = annotation.color
    context.fillText(annotation.text, annotation.x, annotation.y)
    context.restore()
    return
  }
  if (annotation.kind === 'pen' || annotation.kind === 'marker') {
    if (annotation.points.length < 2) return
    context.save()
    context.strokeStyle = annotation.color
    context.lineWidth =
      annotation.kind === 'marker' ? annotation.width * 3 : annotation.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.globalAlpha = annotation.kind === 'marker' ? 0.35 : 1
    context.beginPath()
    context.moveTo(annotation.points[0].x, annotation.points[0].y)
    for (let index = 1; index < annotation.points.length; index += 1) {
      context.lineTo(annotation.points[index].x, annotation.points[index].y)
    }
    context.stroke()
    context.restore()
    return
  }
  if (!('start' in annotation)) return
  const rect = normalizeRect(annotation.start, annotation.end)
  context.save()
  context.strokeStyle = annotation.color
  context.lineWidth = annotation.width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse') {
    context.fillStyle = annotation.color
    context.globalAlpha = 0.12
    if (annotation.kind === 'rect') {
      context.fillRect(rect.x, rect.y, rect.width, rect.height)
    } else {
      context.beginPath()
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        Math.max(1, rect.width / 2),
        Math.max(1, rect.height / 2),
        0,
        0,
        Math.PI * 2
      )
      context.fill()
    }
    context.globalAlpha = 1
    context.beginPath()
    if (annotation.kind === 'rect') {
      context.rect(rect.x, rect.y, rect.width, rect.height)
    } else {
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        Math.max(1, rect.width / 2),
        Math.max(1, rect.height / 2),
        0,
        0,
        Math.PI * 2
      )
    }
    context.stroke()
  } else if (annotation.kind === 'arrow') {
    drawArrow(context, annotation.start, annotation.end, annotation.color, annotation.width)
  } else {
    context.beginPath()
    context.moveTo(annotation.start.x, annotation.start.y)
    context.lineTo(annotation.end.x, annotation.end.y)
    context.stroke()
  }
  context.restore()
}

export function App(): React.JSX.Element {
  const [image, setImage] = useState<ScreenshotImagePayload | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [baseReady, setBaseReady] = useState(false)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [selection, setSelection] = useState<Rect | null>(null)
  const [tool, setTool] = useState<Tool>('move')
  const [color, setColor] = useState(COLORS[0])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [redoStack, setRedoStack] = useState<Annotation[]>([])
  const [preview, setPreview] = useState<Annotation | null>(null)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [magnifier, setMagnifier] = useState<{
    left: number
    top: number
    dipX: number
    dipY: number
    hex: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null)
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const textCommittedRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)

  const logicalWidth = image?.displayWidth ?? viewport.width
  const logicalHeight = image?.displayHeight ?? viewport.height
  const scaleX = image ? image.width / Math.max(1, logicalWidth) : 1
  const scaleY = image ? image.height / Math.max(1, logicalHeight) : 1
  const baseWidth = image ? strokeWidth(image.width) : 3
  const textSize = image ? Math.max(18, Math.round(16 * scaleX)) : 24
  const annotationColor = color

  useEffect(() => window.dsh.screenshot.onImage((payload) => setImage(payload)), [])

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!image || !loaded) return
    const source = imageRef.current
    const canvas = baseCanvasRef.current
    if (!source || !canvas) return
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, image.width, image.height)
    setBaseReady(true)
  }, [image, loaded])

  useEffect(() => {
    const canvas = annotationCanvasRef.current
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (const annotation of annotations) {
      drawAnnotation(context, annotation, image.width, baseCanvasRef.current)
    }
    if (preview) drawAnnotation(context, preview, image.width, baseCanvasRef.current)
  }, [annotations, preview, image, baseReady])

  useEffect(() => {
    if (!textDraft) return
    textInputRef.current?.focus()
    textInputRef.current?.select()
  }, [textDraft])

  useEffect(() => {
    if (!magnifier || !baseReady) return
    const canvas = magnifierCanvasRef.current
    const source = baseCanvasRef.current
    if (!canvas || !source) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ix = Math.round(magnifier.dipX * scaleX)
    const iy = Math.round(magnifier.dipY * scaleY)
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, ix - 4, iy - 4, 9, 9, 0, 0, canvas.width, canvas.height)
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(canvas.width / 2, 0)
    context.lineTo(canvas.width / 2, canvas.height)
    context.moveTo(0, canvas.height / 2)
    context.lineTo(canvas.width, canvas.height / 2)
    context.stroke()
  }, [magnifier, baseReady, scaleX, scaleY])

  const updateMagnifier = (clientX: number, clientY: number): void => {
    if (!image || !baseReady) return
    const ix = clamp(Math.round(clientX * scaleX), 0, image.width - 1)
    const iy = clamp(Math.round(clientY * scaleY), 0, image.height - 1)
    const source = baseCanvasRef.current
    const context = source?.getContext('2d')
    if (!context) return
    const pixel = context.getImageData(ix, iy, 1, 1).data
    const hex = `#${[pixel[0], pixel[1], pixel[2]]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase()
    const panel = 154
    const left = clientX + 20 + panel > viewport.width ? clientX - panel - 16 : clientX + 20
    const top = clientY + 20 + panel > viewport.height ? clientY - panel - 16 : clientY + 20
    setMagnifier({
      left: clamp(left, 8, Math.max(8, viewport.width - panel - 8)),
      top: clamp(top, 8, Math.max(8, viewport.height - panel - 8)),
      dipX: clientX,
      dipY: clientY,
      hex
    })
  }

  const addAnnotation = (annotation: Annotation): void => {
    setAnnotations((current) => [...current, annotation])
    setRedoStack([])
  }

  const undo = (): void => {
    setAnnotations((current) => {
      if (current.length === 0) return current
      const last = current[current.length - 1]
      setRedoStack((redo) => [last, ...redo])
      return current.slice(0, -1)
    })
  }

  const redo = (): void => {
    setRedoStack((current) => {
      if (current.length === 0) return current
      const [first, ...rest] = current
      setAnnotations((annotationsList) => [...annotationsList, first])
      return rest
    })
  }

  const makePreview = (drag: Extract<DragState, { mode: 'draw' }>): Annotation | null => {
    const current = drag.points[drag.points.length - 1] ?? drag.start
    if (tool === 'pen' || tool === 'marker') {
      if (drag.points.length < 2) return null
      return {
        kind: tool,
        points: drag.points,
        color: annotationColor,
        width: baseWidth
      }
    }
    if (tool === 'mosaic') {
      return { kind: 'mosaic', start: drag.start, end: current }
    }
    if (tool === 'text' || tool === 'move') return null
    if (Math.hypot(current.x - drag.start.x, current.y - drag.start.y) < 3) return null
    return {
      kind: tool,
      start: drag.start,
      end: current,
      color: annotationColor,
      width: baseWidth
    }
  }

  const finalizeDraw = (drag: Extract<DragState, { mode: 'draw' }>): void => {
    const current = drag.points[drag.points.length - 1] ?? drag.start
    if (tool === 'pen' || tool === 'marker') {
      if (drag.points.length >= 2) {
        addAnnotation({
          kind: tool,
          points: [...drag.points],
          color: annotationColor,
          width: baseWidth
        })
      }
      return
    }
    if (tool === 'mosaic') {
      if (Math.abs(current.x - drag.start.x) >= 4 && Math.abs(current.y - drag.start.y) >= 4) {
        addAnnotation({ kind: 'mosaic', start: drag.start, end: current })
      }
      return
    }
    if (tool === 'text' || tool === 'move') return
    if (Math.hypot(current.x - drag.start.x, current.y - drag.start.y) >= 4) {
      addAnnotation({
        kind: tool,
        start: drag.start,
        end: current,
        color: annotationColor,
        width: baseWidth
      })
    }
  }

  const startNewSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dip = { x: event.clientX, y: event.clientY }
    setSelection({ x: dip.x, y: dip.y, width: 0, height: 0 })
    setAnnotations([])
    setRedoStack([])
    setTextDraft(null)
    setPreview(null)
    dragRef.current = { mode: 'new', start: dip }
    try {
      overlayRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic events used by diagnostics have no active pointer.
    }
    event.preventDefault()
  }

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.snip-toolbar') || target.closest('.snip-text-input')) return
    if (!selection || selection.width < 1 || selection.height < 1) {
      startNewSelection(event)
      return
    }
    if (target.closest('.snip-selection')) return
    startNewSelection(event)
  }

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !selection) return
    event.stopPropagation()
    event.preventDefault()
    const dip = { x: event.clientX, y: event.clientY }
    if (tool === 'move') {
      dragRef.current = { mode: 'move', start: dip, origin: selection }
      try {
        overlayRef.current?.setPointerCapture(event.pointerId)
      } catch {
        // ignore synthetic pointer capture
      }
      return
    }
    if (tool === 'text') {
      setTextDraft({ x: dip.x * scaleX, y: dip.y * scaleY })
      textCommittedRef.current = false
      return
    }
    const start = { x: dip.x * scaleX, y: dip.y * scaleY }
    dragRef.current = { mode: 'draw', start, points: [start] }
    try {
      overlayRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // ignore synthetic pointer capture
    }
    setPreview(null)
  }

  const handleHandlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    handle: Handle
  ): void => {
    if (event.button !== 0 || !selection) return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = {
      mode: 'resize',
      handle,
      start: { x: event.clientX, y: event.clientY },
      origin: selection
    }
    try {
      overlayRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // ignore synthetic pointer capture
    }
  }

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dip = { x: event.clientX, y: event.clientY }
    setCursor(dip)
    updateMagnifier(dip.x, dip.y)
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'new') {
      const rect = normalizeRect(drag.start, dip)
      setSelection({
        x: clamp(rect.x, 0, viewport.width),
        y: clamp(rect.y, 0, viewport.height),
        width: Math.min(rect.width, viewport.width - clamp(rect.x, 0, viewport.width)),
        height: Math.min(rect.height, viewport.height - clamp(rect.y, 0, viewport.height))
      })
      return
    }
    if (drag.mode === 'move') {
      const x = clamp(drag.origin.x + dip.x - drag.start.x, 0, viewport.width - drag.origin.width)
      const y = clamp(drag.origin.y + dip.y - drag.start.y, 0, viewport.height - drag.origin.height)
      setSelection({ ...drag.origin, x, y })
      return
    }
    if (drag.mode === 'resize') {
      let left = drag.origin.x
      let top = drag.origin.y
      let right = drag.origin.x + drag.origin.width
      let bottom = drag.origin.y + drag.origin.height
      const dx = dip.x - drag.start.x
      const dy = dip.y - drag.start.y
      if (drag.handle.includes('w')) left = clamp(left + dx, 0, right - 16)
      if (drag.handle.includes('e')) right = clamp(right + dx, left + 16, viewport.width)
      if (drag.handle.includes('n')) top = clamp(top + dy, 0, bottom - 16)
      if (drag.handle.includes('s')) bottom = clamp(bottom + dy, top + 16, viewport.height)
      setSelection({ x: left, y: top, width: right - left, height: bottom - top })
      return
    }
    const point = { x: dip.x * scaleX, y: dip.y * scaleY }
    drag.points.push(point)
    setPreview(makePreview(drag))
  }

  const handleOverlayPointerUp = (): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.mode === 'new') {
      setSelection((current) => {
        if (!current || current.width < 16 || current.height < 16) return null
        setTool('move')
        return current
      })
      return
    }
    if (drag.mode === 'draw') {
      finalizeDraw(drag)
      setPreview(null)
    }
  }

  const commitText = (): void => {
    if (!textDraft || textCommittedRef.current) return
    textCommittedRef.current = true
    const value = textInputRef.current?.value.trim() ?? ''
    if (value) {
      addAnnotation({
        kind: 'text',
        x: textDraft.x,
        y: textDraft.y,
        text: value,
        color: annotationColor,
        size: textSize
      })
    }
    setTextDraft(null)
  }

  const compose = (): string | null => {
    if (!image || !selection || !baseReady) return null
    const sx = Math.round(selection.x * scaleX)
    const sy = Math.round(selection.y * scaleY)
    const sw = Math.max(1, Math.round(selection.width * scaleX))
    const sh = Math.max(1, Math.round(selection.height * scaleY))
    const source = baseCanvasRef.current
    if (!source) return null
    const output = document.createElement('canvas')
    output.width = sw
    output.height = sh
    const context = output.getContext('2d')
    if (!context) return null
    context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
    context.save()
    context.translate(-sx, -sy)
    for (const annotation of annotations) {
      drawAnnotation(context, annotation, image.width, source)
    }
    const draftText = textDraft ? (textInputRef.current?.value.trim() ?? '') : ''
    if (textDraft && draftText) {
      drawAnnotation(
        context,
        {
          kind: 'text',
          x: textDraft.x,
          y: textDraft.y,
          text: draftText,
          color: annotationColor,
          size: textSize
        },
        image.width,
        source
      )
    }
    context.restore()
    return output.toDataURL('image/png')
  }

  const closeSoon = (): void => {
    window.setTimeout(() => window.dsh.dialog.close(), 400)
  }

  const save = async (): Promise<void> => {
    const dataUrl = compose()
    if (!dataUrl) {
      setError('请先框选截图区域')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await window.dsh.screenshot.save(dataUrl)
      if (result.ok) {
        setToast('已保存')
        closeSoon()
      } else {
        setError(result.message)
      }
    } catch (cause) {
      setError(`保存失败: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    const dataUrl = compose()
    if (!dataUrl) {
      setError('请先框选截图区域')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await window.dsh.screenshot.copy(dataUrl)
      if (result.ok) {
        setToast('已复制到剪贴板')
        closeSoon()
      } else {
        setError(result.message)
      }
    } catch (cause) {
      setError(`复制失败: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const pin = async (): Promise<void> => {
    const dataUrl = compose()
    if (!dataUrl) {
      setError('请先框选截图区域')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await window.dsh.screenshot.pin(dataUrl)
      if (result.ok) window.dsh.dialog.close()
      else setError(result.message)
    } catch (cause) {
      setError(`贴图失败: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (textDraft) return
      const modifier = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        event.preventDefault()
        window.dsh.dialog.close()
        return
      }
      if (modifier && event.key.toLowerCase() === 'c' && selection) {
        event.preventDefault()
        void copy()
        return
      }
      if (modifier && event.key.toLowerCase() === 's' && selection) {
        event.preventDefault()
        void save()
        return
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'F3' && selection) {
        event.preventDefault()
        void pin()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const toolbarWidth = Math.min(880, viewport.width - 16)
  const toolbarLeft = selection
    ? clamp(selection.x + selection.width / 2 - toolbarWidth / 2, 8, Math.max(8, viewport.width - toolbarWidth - 8))
    : 8
  const toolbarTop = selection
    ? selection.y + selection.height + 64 < viewport.height
      ? selection.y + selection.height + 10
      : Math.max(8, selection.y - 62)
    : 8
  const showSelection = Boolean(selection && selection.width >= 1 && selection.height >= 1)
  const toolLabel = TOOLS.find((item) => item.id === tool)?.label ?? ''

  return (
    <div
      className="snip-overlay"
      ref={overlayRef}
      data-annotation-count={annotations.length}
      data-tool={tool}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={handleOverlayPointerMove}
      onPointerUp={handleOverlayPointerUp}
      onPointerLeave={() => {
        setCursor(null)
        setMagnifier(null)
      }}
      style={{ cursor: !showSelection ? 'crosshair' : tool === 'text' ? 'text' : tool === 'move' ? 'default' : 'crosshair' }}
    >
      {image && (
        <img
          ref={imageRef}
          className="snip-frozen"
          src={image.dataUrl}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      )}
      <canvas ref={baseCanvasRef} className="snip-base-canvas" />
      {!showSelection && <div className="snip-dim" />}
      {showSelection && selection && (
        <>
          <div
            className="snip-dim-panel"
            style={{ left: 0, top: 0, width: '100%', height: selection.y }}
          />
          <div
            className="snip-dim-panel"
            style={{
              left: 0,
              top: selection.y + selection.height,
              width: '100%',
              height: Math.max(0, viewport.height - selection.y - selection.height)
            }}
          />
          <div
            className="snip-dim-panel"
            style={{ left: 0, top: selection.y, width: selection.x, height: selection.height }}
          />
          <div
            className="snip-dim-panel"
            style={{
              left: selection.x + selection.width,
              top: selection.y,
              width: Math.max(0, viewport.width - selection.x - selection.width),
              height: selection.height
            }}
          />
        </>
      )}

      {showSelection && selection && (
        <div
          className="snip-selection"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height
          }}
          onPointerDown={handleSelectionPointerDown}
        >
          <div className="snip-annotation-clip">
            <canvas
              ref={annotationCanvasRef}
              className="snip-annotation-canvas"
              style={{
                left: -selection.x,
                top: -selection.y,
                width: viewport.width,
                height: viewport.height
              }}
            />
          </div>
          <div className="snip-size">
            {Math.round(selection.width)} × {Math.round(selection.height)} DIP
          </div>
          {HANDLES.map((handle) => (
            <div
              key={handle}
              className={`snip-handle snip-handle-${handle}`}
              onPointerDown={(event) => handleHandlePointerDown(event, handle)}
            />
          ))}
        </div>
      )}

      {showSelection && selection && (
        <div
          className="snip-toolbar"
          style={{ left: toolbarLeft, top: toolbarTop, width: toolbarWidth }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerEnter={() => {
            setMagnifier(null)
            setCursor(null)
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="snip-tool-group">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`snip-tool-btn ${tool === item.id ? 'active' : ''}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => setTool(item.id)}
              >
                {item.icon}
              </button>
            ))}
          </div>
          <div className="snip-toolbar-divider" />
          <div className="snip-color-group">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={`snip-color ${value === color ? 'active' : ''}`}
                title={value}
                aria-label={`颜色 ${value}`}
                style={{ background: value }}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
          <div className="snip-toolbar-divider" />
          <div className="snip-action-group">
            <button
              type="button"
              className="snip-action"
              title="撤销 (Ctrl+Z)"
              disabled={annotations.length === 0}
              onClick={undo}
            >
              ↶
            </button>
            <button
              type="button"
              className="snip-action"
              title="重做 (Ctrl+Y)"
              disabled={redoStack.length === 0}
              onClick={redo}
            >
              ↷
            </button>
          </div>
          <span className="snip-tool-label">{toolLabel}</span>
          <div className="snip-toolbar-spacer" />
          <div className="snip-action-group">
            <button type="button" className="snip-action" disabled={busy} onClick={() => void copy()}>
              复制
            </button>
            <button
              type="button"
              className="snip-action snip-action-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存
            </button>
            <button type="button" className="snip-action" disabled={busy} onClick={() => void pin()}>
              贴图
            </button>
            <button
              type="button"
              className="snip-action snip-action-close"
              title="取消 (Esc)"
              onClick={() => window.dsh.dialog.close()}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {textDraft && image && (
        <input
          ref={textInputRef}
          className="snip-text-input"
          style={{
            left: clamp(textDraft.x / scaleX, 4, Math.max(4, viewport.width - 200)),
            top: clamp(textDraft.y / scaleY, 4, Math.max(4, viewport.height - 40)),
            color,
            borderColor: color,
            fontSize: Math.max(14, Math.min(32, textSize / scaleX))
          }}
          defaultValue=""
          placeholder="输入文字…"
          aria-label="文字标注"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              commitText()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              textCommittedRef.current = true
              setTextDraft(null)
            }
          }}
          onBlur={commitText}
        />
      )}

      {magnifier && !textDraft && (
        <div className="snip-magnifier" style={{ left: magnifier.left, top: magnifier.top }}>
          <canvas ref={magnifierCanvasRef} width={126} height={126} />
          <div className="snip-mag-info">
            <span className="snip-mag-dot" style={{ background: magnifier.hex }} />
            <span>{magnifier.hex}</span>
            <span>
              X {Math.round(magnifier.dipX)} · Y {Math.round(magnifier.dipY)}
            </span>
          </div>
        </div>
      )}

      {!showSelection && cursor && (
        <>
          <div className="snip-cross-v" style={{ left: cursor.x }} />
          <div className="snip-cross-h" style={{ top: cursor.y }} />
        </>
      )}

      {!image && <div className="snip-loading">正在冻结屏幕…</div>}
      {error && <div className="snip-error">{error}</div>}
      {toast && <div className="snip-toast">{toast}</div>}
    </div>
  )
}
