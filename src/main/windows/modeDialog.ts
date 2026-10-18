import { BrowserWindow } from 'electron'
import { OWN_WINDOW_PREFIX } from '@shared/types'
import { createWindow, loadPage, showWhenReady } from './windowFactory'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'

let modeWindow: BrowserWindow | null = null

export function showModeDialog(): void {
  if (modeWindow && !modeWindow.isDestroyed()) {
    modeWindow.show()
    modeWindow.focus()
    return
  }
  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 录屏`,
    width: 560,
    height: 640,
    resizable: false,
    backgroundColor: '#141414'
  })
  modeWindow = win
  const webContentsId = win.webContents.id
  allowWebContents(webContentsId)
  win.once('closed', () => {
    disallowWebContents(webContentsId)
    if (modeWindow === win) modeWindow = null
  })
  loadPage(win, 'mode')
  showWhenReady(win)
}

export function getModeWindow(): BrowserWindow | null {
  return modeWindow && !modeWindow.isDestroyed() ? modeWindow : null
}
