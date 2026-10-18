import { BrowserWindow } from 'electron'
import { OWN_WINDOW_PREFIX } from '@shared/types'
import { createWindow, loadPage, showWhenReady } from './windowFactory'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'

let settingsWindow: BrowserWindow | null = null

export function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 设置`,
    width: 600,
    height: 640,
    resizable: false,
    backgroundColor: '#141414'
  })
  settingsWindow = win
  const webContentsId = win.webContents.id
  allowWebContents(webContentsId)
  win.once('closed', () => {
    disallowWebContents(webContentsId)
    if (settingsWindow === win) settingsWindow = null
  })
  loadPage(win, 'settings')
  showWhenReady(win)
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}
