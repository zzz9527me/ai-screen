import type { Region } from '@shared/types'

const overlay = document.getElementById('overlay') as HTMLDivElement
const selection = document.getElementById('selection') as HTMLDivElement
const hint = document.getElementById('hint') as HTMLDivElement

let startX = 0
let startY = 0
let dragging = false
let rect: Region = { x: 0, y: 0, width: 0, height: 0 }

function updateRect(clientX: number, clientY: number): void {
  const x = Math.min(startX, clientX)
  const y = Math.min(startY, clientY)
  rect = { x, y, width: Math.abs(clientX - startX), height: Math.abs(clientY - startY) }
  selection.style.display = 'block'
  selection.style.left = `${rect.x}px`
  selection.style.top = `${rect.y}px`
  selection.style.width = `${rect.width}px`
  selection.style.height = `${rect.height}px`
  hint.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
}

overlay.addEventListener('mousedown', (event: MouseEvent) => {
  if (event.button !== 0) return
  dragging = true
  startX = event.clientX
  startY = event.clientY
  updateRect(event.clientX, event.clientY)
})

window.addEventListener('mousemove', (event: MouseEvent) => {
  if (!dragging) return
  updateRect(event.clientX, event.clientY)
})

window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  const region: Region = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
  if (region.width < 16 || region.height < 16) {
    hint.textContent = '区域太小(至少 16×16),请重新框选'
    selection.style.display = 'none'
    return
  }
  window.dsh.internal.overlay.report(region)
})

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') window.dsh.internal.overlay.cancel()
})
