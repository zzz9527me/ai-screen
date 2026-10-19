import { BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { OWN_WINDOW_PREFIX, type ScreenshotImagePayload } from '@shared/types'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'
import { createWindow, loadPage, showWhenReady } from './windowFactory'

let screenshotWindow: BrowserWindow | null = null

/**
 * Snipaste-style overlay: freeze the primary display, cover it with a borderless
 * fullscreen layer, and let the renderer draw the selection and annotations.
 */
export function showScreenshotEditor(image: ScreenshotImagePayload): void {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.show()
    screenshotWindow.focus()
    return
  }

  const display = screen.getPrimaryDisplay()
  const bounds = display.bounds
  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 截屏`,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: false,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: { backgroundThrottling: false }
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
  win.once('show', () => {
    if (win.isDestroyed()) return
    win.setContentBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    })
    win.focus()
  })
}

export function getScreenshotWindow(): BrowserWindow | null {
  return screenshotWindow && !screenshotWindow.isDestroyed() ? screenshotWindow : null
}
