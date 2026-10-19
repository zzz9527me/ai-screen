import {
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage
} from 'electron'
import fs from 'node:fs'
import { IPC } from '@shared/ipc-channels'
import {
  captureChunkSchema,
  captureFinishedSchema,
  captureReadySchema,
  screenshotPayloadSchema,
  settingsInputSchema,
  startCaptureRequestSchema
} from '@shared/schemas'
import type { AppState, Settings, SettingsInput } from '@shared/types'
import { listWindowSources } from '../services/captureSources'
import { uniqueScreenshotPath } from '../services/filename'
import { showScreenshotSavedNotification } from '../services/notifications'
import type { RecordingSessionManager } from '../services/recordingSession'
import type { SettingsStore } from '../services/settingsStore'
import { showRegionSelector } from '../windows/regionOverlay'

export interface IpcContext {
  settings: SettingsStore
  session: RecordingSessionManager
  broadcastState(state: AppState): void
  broadcastSettings(settings: Settings): void
  validateShortcut?(shortcut: string): boolean
  applyShortcut?(shortcut: string): void
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
    if (
      parsed.data.screenshotShortcut &&
      context.validateShortcut &&
      !context.validateShortcut(parsed.data.screenshotShortcut)
    ) {
      return {
        ok: false,
        errors: [
          {
            field: 'screenshotShortcut',
            message: '该快捷键不可用或已被其他程序占用,请换一个组合'
          }
        ]
      }
    }
    const result = context.settings.save(parsed.data)
    if (result.ok) {
      context.broadcastSettings(result.settings)
      context.applyShortcut?.(result.settings.screenshotShortcut)
    }
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

  ipcMain.handle(IPC.ScreenshotSave, async (event, payload: unknown) => {
    assertAllowed(event)
    const parsed = screenshotPayloadSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, message: '图片数据无效' }
    let image: Electron.NativeImage
    try {
      image = nativeImage.createFromDataURL(parsed.data.dataUrl)
    } catch {
      return { ok: false, message: '图片数据无法解析' }
    }
    if (image.isEmpty()) return { ok: false, message: '图片数据为空' }
    const buffer = image.toPNG()
    if (buffer.length === 0) return { ok: false, message: '图片编码失败' }

    const directory = context.settings.get().storageDirectory
    try {
      await fs.promises.mkdir(directory, { recursive: true })
      await fs.promises.access(directory, fs.constants.W_OK)
      const outputPath = await uniqueScreenshotPath(directory, new Date())
      await fs.promises.writeFile(outputPath, buffer)
      showScreenshotSavedNotification(outputPath)
      return { ok: true, path: outputPath }
    } catch (error) {
      return {
        ok: false,
        message: `保存截图失败: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  })

  ipcMain.handle(IPC.ScreenshotCopy, async (event, payload: unknown) => {
    assertAllowed(event)
    const parsed = screenshotPayloadSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, message: '图片数据无效' }
    try {
      const image = nativeImage.createFromDataURL(parsed.data.dataUrl)
      if (image.isEmpty()) return { ok: false, message: '图片数据为空' }
      const png = image.toPNG()
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' })
        })
      ])
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: `复制图片失败: ${error instanceof Error ? error.message : String(error)}`
      }
    }
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
