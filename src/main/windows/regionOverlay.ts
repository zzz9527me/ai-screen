import { ipcMain, screen } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { Region } from '@shared/types'
import { OWN_WINDOW_PREFIX } from '@shared/types'
import { createWindow, loadPage } from './windowFactory'
import { clampRegion, isRegionValid } from '../services/regionMath'

/**
 * Shows a transparent fullscreen overlay on the primary display and resolves
 * with the DIP rectangle the user drags (or null when cancelled / invalid).
 */
export async function showRegionSelector(): Promise<Region | null> {
  const display = screen.getPrimaryDisplay()
  const bounds = display.bounds

  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 区域选择`,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false }
  })
  loadPage(win, 'overlay', {
    width: String(bounds.width),
    height: String(bounds.height),
    scale: String(display.scaleFactor)
  })
  win.show()
  win.focus()

  return new Promise<Region | null>((resolve) => {
    let settled = false
    const finish = (rect: Region | null): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener(IPC.RegionSelected, onSelected)
      ipcMain.removeListener(IPC.RegionCancelled, onCancelled)
      if (!win.isDestroyed()) win.destroy()
      resolve(rect)
    }
    const onSelected = (event: Electron.IpcMainEvent, payload: { rect?: Region }): void => {
      if (event.sender !== win.webContents) return
      const rect = payload?.rect
      if (!rect) {
        finish(null)
        return
      }
      const clamped = clampRegion(rect, bounds)
      finish(isRegionValid(clamped, bounds) ? clamped : null)
    }
    const onCancelled = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== win.webContents) return
      finish(null)
    }
    ipcMain.on(IPC.RegionSelected, onSelected)
    ipcMain.on(IPC.RegionCancelled, onCancelled)
    win.once('closed', () => finish(null))
  })
}
