import { BrowserWindow, session } from 'electron'
import { OWN_WINDOW_PREFIX } from '@shared/types'
import { createWindow, loadPage } from './windowFactory'
import { allowWebContents, disallowWebContents } from '../ipc/handlers'
import { findSourceById } from '../services/captureSources'

let pendingSourceId: string | null = null

export function primeDisplayMediaSource(sourceId: string): void {
  pendingSourceId = sourceId
}

export function clearDisplayMediaSource(): void {
  pendingSourceId = null
}

/**
 * Grants display capture only for the source we primed before sending
 * `capture:begin`, and permits media permissions only for the capture renderer.
 */
export function installDisplayMediaHandler(): void {
  const ses = session.defaultSession
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const sourceId = pendingSourceId
      pendingSourceId = null
      if (!sourceId) {
        callback(null)
        return
      }
      void findSourceById(sourceId).then(
        (source) => {
          if (source) callback({ video: source })
          else callback(null)
        },
        () => callback(null)
      )
    },
    { useSystemPicker: false }
  )

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(webContents.getURL().includes('/capture/'))
      return
    }
    callback(false)
  })
}

export function createCaptureWindow(): BrowserWindow {
  const win = createWindow({
    title: `${OWN_WINDOW_PREFIX} 录制引擎`,
    width: 480,
    height: 320,
    frame: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: { backgroundThrottling: false }
  })
  const webContentsId = win.webContents.id
  allowWebContents(webContentsId)
  win.once('closed', () => disallowWebContents(webContentsId))
  loadPage(win, 'capture')
  return win
}
