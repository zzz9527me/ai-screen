import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  AppState,
  CaptureBeginPayload,
  CaptureFinishedPayload,
  CaptureReadyPayload,
  DshApi,
  Region,
  ScreenshotImagePayload,
  Settings,
  SettingsInput,
  StartCaptureRequest
} from '@shared/types'

const screenshotImageListeners = new Set<(payload: ScreenshotImagePayload) => void>()
let pendingScreenshotImage: ScreenshotImagePayload | null = null

ipcRenderer.on(IPC.ScreenshotImage, (_event, payload: ScreenshotImagePayload) => {
  if (screenshotImageListeners.size === 0) {
    pendingScreenshotImage = payload
    return
  }
  for (const listener of screenshotImageListeners) listener(payload)
})

const api: DshApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.SettingsGet),
    save: (patch: SettingsInput) => ipcRenderer.invoke(IPC.SettingsSave, patch),
    pickFolder: () => ipcRenderer.invoke(IPC.PickFolder)
  },
  windows: {
    list: () => ipcRenderer.invoke(IPC.ListWindows)
  },
  region: {
    pick: () => ipcRenderer.invoke(IPC.RegionSelect)
  },
  capture: {
    start: (request: StartCaptureRequest) => ipcRenderer.invoke(IPC.CaptureStart, request),
    stop: () => ipcRenderer.invoke(IPC.CaptureStop)
  },
  screenshot: {
    onImage(cb: (payload: ScreenshotImagePayload) => void) {
      screenshotImageListeners.add(cb)
      if (pendingScreenshotImage) {
        const payload = pendingScreenshotImage
        pendingScreenshotImage = null
        cb(payload)
      }
      return () => screenshotImageListeners.delete(cb)
    },
    save: (dataUrl: string) => ipcRenderer.invoke(IPC.ScreenshotSave, { dataUrl }),
    copy: (dataUrl: string) => ipcRenderer.invoke(IPC.ScreenshotCopy, { dataUrl })
  },
  dialog: {
    close: () => ipcRenderer.send(IPC.DialogClose)
  },
  events: {
    onState(cb: (state: AppState) => void) {
      const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => cb(state)
      ipcRenderer.on(IPC.StateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.StateChanged, listener)
    },
    onError(cb: (message: string) => void) {
      const listener = (_event: Electron.IpcRendererEvent, message: string): void => cb(message)
      ipcRenderer.on(IPC.ToastError, listener)
      return () => ipcRenderer.removeListener(IPC.ToastError, listener)
    },
    onSettingsChanged(cb: (settings: Settings) => void) {
      const listener = (_event: Electron.IpcRendererEvent, settings: Settings): void =>
        cb(settings)
      ipcRenderer.on(IPC.SettingsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.SettingsChanged, listener)
    }
  },
  internal: {
    overlay: {
      report: (rect: Region) => ipcRenderer.send(IPC.RegionSelected, { rect }),
      cancel: () => ipcRenderer.send(IPC.RegionCancelled, {})
    },
    capture: {
      onBegin(cb: (payload: CaptureBeginPayload) => void) {
        const listener = (_event: Electron.IpcRendererEvent, payload: CaptureBeginPayload): void =>
          cb(payload)
        ipcRenderer.on(IPC.CaptureBegin, listener)
        return () => ipcRenderer.removeListener(IPC.CaptureBegin, listener)
      },
      onAbort(cb: (reason: string) => void) {
        const listener = (
          _event: Electron.IpcRendererEvent,
          payload: { reason?: string }
        ): void => cb(payload?.reason ?? '')
        ipcRenderer.on(IPC.CaptureAbort, listener)
        return () => ipcRenderer.removeListener(IPC.CaptureAbort, listener)
      },
      ready: (sessionId: string, mimeType: string): void =>
        ipcRenderer.send(IPC.CaptureReady, { sessionId, mimeType } satisfies CaptureReadyPayload),
      chunk: (sessionId: string, data: ArrayBuffer): void =>
        ipcRenderer.send(IPC.CaptureChunk, { sessionId, data }),
      finished: (
        sessionId: string,
        ok: boolean,
        outputPath?: string,
        error?: string
      ): void =>
        ipcRenderer.send(IPC.CaptureFinished, {
          sessionId,
          ok,
          outputPath,
          error
        } satisfies CaptureFinishedPayload)
    }
  }
}

contextBridge.exposeInMainWorld('dsh', api)
