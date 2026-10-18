import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import {
  captureChunkSchema,
  captureFinishedSchema,
  captureReadySchema,
  settingsInputSchema,
  startCaptureRequestSchema
} from '@shared/schemas'
import type { AppState, Settings, SettingsInput } from '@shared/types'
import { listWindowSources } from '../services/captureSources'
import type { RecordingSessionManager } from '../services/recordingSession'
import type { SettingsStore } from '../services/settingsStore'
import { showRegionSelector } from '../windows/regionOverlay'

export interface IpcContext {
  settings: SettingsStore
  session: RecordingSessionManager
  broadcastState(state: AppState): void
  broadcastSettings(settings: Settings): void
}

const allowedSenders = new Set<number>()

export function allowWebContents(id: number): void {
  allowedSenders.add(id)
}

export function disallowWebContents(id: number): void {
  allowedSenders.delete(id)
}

function isAllowed(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return allowedSenders.has(event.sender.id)
}

function assertAllowed(event: Electron.IpcMainInvokeEvent): void {
  if (!isAllowed(event)) throw new Error('未授权的调用方')
}

function fieldErrors(error: {
  issues: Array<{ path: Array<string | number | symbol>; message: string }>
}): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.map((part) => String(part)).join('.') || 'settings',
    message: issue.message
  }))
}

export function registerIpc(context: IpcContext): void {
  ipcMain.handle(IPC.SettingsGet, (event) => {
    assertAllowed(event)
    return context.settings.get()
  })

  ipcMain.handle(IPC.SettingsSave, (event, input: SettingsInput) => {
    assertAllowed(event)
    const parsed = settingsInputSchema.safeParse(input)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const result = context.settings.save(parsed.data)
    if (result.ok) context.broadcastSettings(result.settings)
    return result
  })

  ipcMain.handle(IPC.PickFolder, async (event) => {
    assertAllowed(event)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { path: null }
    return { path: result.filePaths[0] }
  })

  ipcMain.handle(IPC.ListWindows, async (event) => {
    assertAllowed(event)
    try {
      return { ok: true, sources: await listWindowSources() }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(IPC.RegionSelect, async (event) => {
    assertAllowed(event)
    const rect = await showRegionSelector()
    if (!rect) return { ok: false, cancelled: true }
    return { ok: true, rect }
  })

  ipcMain.handle(IPC.CaptureStart, async (event, request: unknown) => {
    assertAllowed(event)
    const parsed = startCaptureRequestSchema.safeParse(request)
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_TARGET', message: '录制参数无效' }
    }
    return context.session.start(parsed.data)
  })

  ipcMain.handle(IPC.CaptureStop, async (event) => {
    assertAllowed(event)
    return context.session.stop()
  })

  ipcMain.on(IPC.DialogClose, (event) => {
    if (!isAllowed(event)) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.on(IPC.CaptureReady, (event, payload: unknown) => {
    if (!isAllowed(event)) return
    const parsed = captureReadySchema.safeParse(payload)
    if (parsed.success) context.session.onReady(parsed.data)
  })

  ipcMain.on(IPC.CaptureChunk, (event, payload: unknown) => {
    if (!isAllowed(event)) return
    const parsed = captureChunkSchema.safeParse(payload)
    if (!parsed.success) {
      if (process.env.DSH_DIAGNOSE === '1') {
        console.error('[diag] chunk schema failed:', parsed.error.message)
      }
      return
    }
    context.session.onChunk(parsed.data)
  })

  ipcMain.on(IPC.CaptureFinished, (event, payload: unknown) => {
    if (!isAllowed(event)) return
    const parsed = captureFinishedSchema.safeParse(payload)
    if (parsed.success) void context.session.onFinished(parsed.data)
  })
}
