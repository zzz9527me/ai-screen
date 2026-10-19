import { app, BrowserWindow, dialog, Menu, powerSaveBlocker, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc-channels'
import { MP4_MIME_CANDIDATES } from '@shared/mime'
import { DEFAULT_SCREENSHOT_SHORTCUT } from '@shared/shortcut'
import { registerIpc } from './ipc/handlers'
import { runDiagnostics } from './diagnostics'
import { CrashRecovery } from './services/crashRecovery'
import { findSourceById, getPrimaryScreenSource } from './services/captureSources'
import { FileSink } from './services/fileSink'
import { uniqueFilePath } from './services/filename'
import { checkMp4File } from './services/mp4Probe'
import {
  showErrorNotification,
  showRecoveryNotification,
  showSaveNotification
} from './services/notifications'
import { RecordingSessionManager } from './services/recordingSession'
import { capturePrimaryScreen } from './services/screenshot'
import { SettingsStore } from './services/settingsStore'
import { ShortcutManager } from './services/shortcutManager'
import { AppTray } from './tray'
import {
  createCaptureWindow,
  installDisplayMediaHandler,
  primeDisplayMediaSource
} from './windows/captureWindow'
import { showModeDialog } from './windows/modeDialog'
import { getScreenshotWindow, showScreenshotEditor } from './windows/screenshotWindow'
import { showSettingsWindow } from './windows/settingsWindow'

app.setAppUserModelId('com.dsh.screen-recorder')

process.on('uncaughtException', (error) => {
  console.error('[main] uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason)
})

function isWritableDirectory(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.write-probe')
    fs.writeFileSync(probe, 'ok')
    fs.renameSync(probe, `${probe}.done`)
    fs.rmSync(`${probe}.done`, { force: true })
    return true
  } catch {
    return false
  }
}

function migrateSettings(oldDir: string, newDir: string): void {
  try {
    const source = path.join(oldDir, 'settings.json')
    const target = path.join(newDir, 'settings.json')
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.copyFileSync(source, target)
    }
  } catch {
    // Migration is best effort; defaults will be used if it fails.
  }
}

/**
 * Chromium needs a fully writable userData directory for its caches. Some
 * sandboxed environments make %APPDATA% read-only, which crashes the renderer
 * and breaks IPC. Prefer a fresh writable subdirectory, then temp as fallback.
 */
function resolveUserData(): string {
  const defaultDir = app.getPath('userData')
  const preferred = path.join(defaultDir, 'app-data')
  if (isWritableDirectory(preferred)) {
    migrateSettings(defaultDir, preferred)
    return preferred
  }
  const fallback = path.join(app.getPath('temp'), 'dsh-screen-recorder')
  if (isWritableDirectory(fallback)) return fallback
  return defaultDir
}

app.setPath('userData', resolveUserData())

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showModeDialog()
  })

  let tray: AppTray | null = null
  let sessionManager: RecordingSessionManager | null = null
  let shortcutManager: ShortcutManager | null = null
  let screenshotBusy = false
  let quitting = false
  let powerBlockerId: number | null = null

  const openScreenshot = async (): Promise<void> => {
    const existing = getScreenshotWindow()
    if (existing) {
      existing.show()
      existing.focus()
      return
    }
    if (screenshotBusy) return
    screenshotBusy = true
    try {
      const image = await capturePrimaryScreen()
      showScreenshotEditor(image)
    } catch (error) {
      showErrorNotification(
        `截屏失败: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      screenshotBusy = false
    }
  }

  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.isDestroyed() || win.webContents.isDestroyed()) continue
        if (win.webContents.getURL().includes('/capture/')) continue
        win.webContents.send(channel, payload)
      } catch {
        // Window closed while broadcasting; ignore.
      }
    }
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)

    if (process.env.DSH_DIAGNOSE === '1') {
      app.on('web-contents-created', (_event, contents) => {
        contents.on('console-message', (...args: unknown[]) => {
          const details = args[1] as { message?: string } | undefined
          const message = details && typeof details === 'object' ? details.message : String(args[2])
          console.error(`[renderer:${contents.id}] ${message ?? ''}`)
        })
      })
    }

    const settings = new SettingsStore({
      userDataDir: app.getPath('userData'),
      videosDir: app.getPath('videos'),
      getPrimaryDisplay: () => {
        const display = screen.getPrimaryDisplay()
        return {
          width: display.size.width,
          height: display.size.height,
          scaleFactor: display.scaleFactor
        }
      }
    })

    const crashRecovery = new CrashRecovery(app.getPath('userData'))

    const manager = new RecordingSessionManager({
      settings: { get: () => settings.get() },
      writeMarker: (marker) => crashRecovery.writeMarker(marker),
      clearMarker: () => crashRecovery.clearMarker(),
      createSink: (filePath) => new FileSink(filePath),
      validateMp4: (filePath) => checkMp4File(filePath),
      notifySaved: (filePath) => {
        showSaveNotification(filePath)
        tray?.setTooltip(`已保存: ${path.basename(filePath)}`)
      },
      notifyError: (message) => {
        showErrorNotification(message)
        tray?.setTooltip('DSH 屏幕录制器')
      },
      setAppState: (state) => {
        tray?.setRecordingState(state === 'recording')
        broadcast(IPC.StateChanged, state)
      },
      uniqueFilePath: (directory, date) => uniqueFilePath(directory, date),
      ensureDirectory: async (directory) => {
        await fs.promises.mkdir(directory, { recursive: true })
        await fs.promises.access(directory, fs.constants.W_OK)
      },
      getPrimaryDisplay: () => {
        const display = screen.getPrimaryDisplay()
        return {
          id: display.id,
          width: display.size.width,
          height: display.size.height,
          scaleFactor: display.scaleFactor
        }
      },
      getPrimaryScreenSourceId: async () => (await getPrimaryScreenSource())?.id,
      getWindowSource: async (id) => {
        const source = await findSourceById(id)
        return source ? { id: source.id, name: source.name } : undefined
      },
      createCaptureWindow,
      primeDisplayMediaSource,
      mimeCandidates: [...MP4_MIME_CANDIDATES],
      now: () => new Date(),
      setPowerSaveBlocker: (active) => {
        if (active) {
          if (powerBlockerId === null) {
            powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
          }
          return
        }
        if (powerBlockerId !== null) {
          powerSaveBlocker.stop(powerBlockerId)
          powerBlockerId = null
        }
      }
    })

    sessionManager = manager
    installDisplayMediaHandler()

    registerIpc({
      settings,
      session: manager,
      broadcastState: (state) => broadcast(IPC.StateChanged, state),
      broadcastSettings: (value) => broadcast(IPC.SettingsChanged, value),
      validateShortcut: (shortcut) => shortcutManager?.canRegister(shortcut) ?? true,
      applyShortcut: (shortcut) => {
        if (shortcutManager && !shortcutManager.update(shortcut)) {
          showErrorNotification(`截屏快捷键 ${shortcut} 注册失败,请到设置中换一个组合`)
        }
      }
    })

    tray = new AppTray({
      onRecord: () => showModeDialog(),
      onScreenshot: () => {
        void openScreenshot()
      },
      onSettings: () => showSettingsWindow(),
      onStop: () => {
        void manager.stop()
      },
      onQuit: () => app.quit()
    })
    tray.create()

    shortcutManager = new ShortcutManager(() => {
      void openScreenshot()
    })
    const configuredShortcut = settings.get().screenshotShortcut
    if (!shortcutManager.register(configuredShortcut)) {
      if (
        configuredShortcut !== DEFAULT_SCREENSHOT_SHORTCUT &&
        shortcutManager.register(DEFAULT_SCREENSHOT_SHORTCUT)
      ) {
        showErrorNotification(
          `截屏快捷键 ${configuredShortcut} 不可用,已临时使用 ${DEFAULT_SCREENSHOT_SHORTCUT}`
        )
      } else {
        showErrorNotification(
          `截屏快捷键 ${configuredShortcut} 注册失败,请到设置中修改`
        )
      }
    }

    const leftover = crashRecovery.detectLeftover()
    if (leftover) showRecoveryNotification(leftover)

    if (process.env.DSH_DIAGNOSE === '1') {
      void runDiagnostics({
        showModeDialog,
        showSettingsWindow,
        stopRecording: () => manager.stop(),
        getState: () => manager.getState(),
        openScreenshot,
        getStorageDirectory: () => settings.get().storageDirectory,
        getTrayMenuLabels: () => tray?.getMenuLabels() ?? []
      })
    }
  })

  app.on('will-quit', () => {
    shortcutManager?.dispose()
  })

  app.on('window-all-closed', () => {
    // Tray application: keep running when every window is closed.
    if (process.env.DSH_DIAGNOSE === '1') console.error('[diag] window-all-closed')
  })

  app.on('before-quit', (event) => {
    if (process.env.DSH_DIAGNOSE === '1') {
      console.error('[diag] before-quit', {
        quitting,
        active: sessionManager ? sessionManager.isActive() : null
      })
    }
    if (quitting || !sessionManager || !sessionManager.isActive()) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['停止并保存', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: 'DSH 屏幕录制器',
      message: '正在录制,是否停止并保存后退出?'
    })
    if (choice === 0) {
      quitting = true
      void sessionManager.stop().finally(() => app.quit())
    }
  })
}
