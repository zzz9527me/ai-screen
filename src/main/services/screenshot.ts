import { desktopCapturer, screen } from 'electron'
import type { ScreenshotImagePayload } from '@shared/types'

/**
 * Captures the primary display at physical pixel resolution. The PNG data URL
 * is small enough for IPC (< ~20 MB for 4K) and avoids extra native buffers.
 */
export async function capturePrimaryScreen(): Promise<ScreenshotImagePayload> {
  const display = screen.getPrimaryDisplay()
  const width = Math.max(1, Math.round(display.size.width * display.scaleFactor))
  const height = Math.max(1, Math.round(display.size.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法捕获主显示器画面')
  }
  const size = source.thumbnail.getSize()
  return {
    dataUrl: source.thumbnail.toDataURL(),
    width: size.width,
    height: size.height,
    displayWidth: display.size.width,
    displayHeight: display.size.height
  }
}
