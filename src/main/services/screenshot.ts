import { desktopCapturer, nativeImage, screen } from 'electron'
import type { Region, ScreenshotImagePayload } from '@shared/types'

export interface DisplaySize {
  width: number
  height: number
}

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
    height: size.height
  }
}

/**
 * Crops a physical-pixel screenshot to a DIP selection made on the primary
 * display. The captured thumbnail may be scaled by Windows, so convert through
 * the actual image/display ratio instead of assuming scaleFactor.
 */
export function cropScreenshot(
  image: ScreenshotImagePayload,
  region: Region,
  display: DisplaySize
): ScreenshotImagePayload {
  const source = nativeImage.createFromDataURL(image.dataUrl)
  const size = source.getSize()
  if (source.isEmpty() || size.width === 0 || size.height === 0) {
    throw new Error('截图数据为空')
  }
  const scaleX = size.width / display.width
  const scaleY = size.height / display.height
  const x = Math.max(0, Math.min(size.width - 1, Math.round(region.x * scaleX)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(region.y * scaleY)))
  const width = Math.max(1, Math.min(size.width - x, Math.round(region.width * scaleX)))
  const height = Math.max(1, Math.min(size.height - y, Math.round(region.height * scaleY)))
  const cropped = source.crop({ x, y, width, height })
  const croppedSize = cropped.getSize()
  return {
    dataUrl: cropped.toDataURL(),
    width: croppedSize.width,
    height: croppedSize.height
  }
}
