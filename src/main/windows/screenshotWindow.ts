import { BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { OWN_WINDOW_PREFIX, type ScreenshotImagePayload } from '@shared/types'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'
import { createWindow, loadPage, showWhenReady } from './windowFactory'

let screenshotWindow: BrowserWindow | null = null

export function showScreenshotEditor(image: ScreenshotImagePayload): void {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.show()
    screenshotWindow.focus()
    return
  }

  const display = screen.getPrimaryDisplay()
  const maxWidth = Math.max(480, Math.floor(display.workArea.width * 0.92))
  const maxHeight = Math.max(360, Math.floor(display.workArea.height * 0.9) - 76)
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
  const width = Math.max(480, Math.round(image.width * scale))
  const height = Math.max(320, Math.round(image.height * scale) + 76)

  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 截屏编辑`,
    width,
    height,
    resizable: true,
    useContentSize: true,
    backgroundColor: '#0b0b0d'
  })
  screenshotWindow = win
  const webContentsId = win.webContents.id
  allowWebContents(webContentsId)
  win.once('closed', () => {
    disallowWebContents(webContentsId)
    if (screenshotWindow === win) screenshotWindow = null
  })
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.ScreenshotImage, image)
  })
  loadPage(win, 'screenshot')
  showWhenReady(win)
}

export function getScreenshotWindow(): BrowserWindow | null {
  return screenshotWindow && !screenshotWindow.isDestroyed() ? screenshotWindow : null
}
