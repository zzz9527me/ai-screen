import { BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { OWN_WINDOW_PREFIX, type ScreenshotImagePayload } from '@shared/types'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'
import { createWindow, loadPage, showWhenReady } from './windowFactory'

const pinWindows = new Set<BrowserWindow>()

/** Creates a simple Snipaste-style always-on-top image window. */
export function createPinWindow(image: Electron.NativeImage): void {
  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) throw new Error('图片尺寸无效')
  const workArea = screen.getPrimaryDisplay().workArea
  const scale = Math.min(1, (workArea.width * 0.85) / size.width, (workArea.height * 0.85) / size.height)
  const width = Math.max(200, Math.round(size.width * scale))
  const height = Math.max(120, Math.round(size.height * scale))

  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 贴图`,
    width,
    height,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    useContentSize: true,
    backgroundColor: '#0b0b0d'
  })
  pinWindows.add(win)
  const webContentsId = win.webContents.id
  allowWebContents(webContentsId)
  win.once('closed', () => {
    disallowWebContents(webContentsId)
    pinWindows.delete(win)
  })

  const payload: ScreenshotImagePayload = {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height
  }
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.ScreenshotImage, payload)
  })
  win.center()
  loadPage(win, 'pin')
  showWhenReady(win)
}
