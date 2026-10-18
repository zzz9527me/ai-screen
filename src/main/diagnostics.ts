import { app, BrowserWindow, desktopCapturer } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { StopCaptureResult } from '@shared/types'
import { allowWebContents } from './ipc/handlers'
import { createWindow, loadPage } from './windows/windowFactory'

export interface DiagnosticsContext {
  showModeDialog(): void
  showSettingsWindow(): void
  stopRecording(): Promise<StopCaptureResult>
  getState(): string
}

interface Step {
  step: string
  ok: boolean
  value?: unknown
}

interface ConsoleEntry {
  level: string
  message: string
  source: string
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function waitForLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (!win.webContents.isLoading()) {
      resolve()
      return
    }
    win.webContents.once('did-finish-load', () => resolve())
  })
}

async function waitForWindow(
  fragment: string,
  timeoutMs = 8000,
  excludeId?: number
): Promise<BrowserWindow | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = BrowserWindow.getAllWindows().find((window) => {
      try {
        return (
          !window.isDestroyed() &&
          window.webContents.id !== excludeId &&
          window.webContents.getURL().includes(fragment)
        )
      } catch {
        return false
      }
    })
    if (found) return found
    await wait(100)
  }
  return undefined
}

/**
 * Full user-flow simulation: tray handlers open real windows, UI buttons are
 * clicked, the region overlay is dragged with synthetic mouse input, and the
 * tray stop action finalizes recordings. All console/preload errors are
 * collected so a green run means no user-visible errors were emitted.
 */
export async function runDiagnostics(ctx: DiagnosticsContext): Promise<void> {
  const recordHoldMs = Number(process.env.DSH_DIAGNOSE_HOLD_MS ?? '1800')
  const hold = Number.isFinite(recordHoldMs) && recordHoldMs > 0 ? recordHoldMs : 1800
  const steps: Step[] = []
  const consoleEntries: ConsoleEntry[] = []
  const pageEvents: string[] = []
  const resultPath = path.join(process.cwd(), 'diagnostic-result.json')

  const persist = (): void => {
    const errors = consoleEntries.filter(
      (entry) =>
        entry.level === 'error' ||
        /Uncaught|TypeError|ReferenceError|Cannot read|Failed to load|ERR_/.test(entry.message)
    )
    const output = {
      pid: process.pid,
      appPath: app.getAppPath(),
      steps,
      console: {
        total: consoleEntries.length,
        errors: errors.slice(0, 30),
        errorCount: errors.length
      },
      pageEvents
    }
    fs.writeFileSync(resultPath, JSON.stringify(output, null, 2))
  }

  const record = (step: string, value: unknown): void => {
    steps.push({ step, ok: true, value })
    console.error('[diag] step', step, JSON.stringify(value))
    persist()
  }
  const recordError = (step: string, error: unknown): void => {
    steps.push({ step, ok: false, value: String(error) })
    console.error('[diag] error', step, String(error))
    persist()
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (...args: unknown[]) => {
      const details = args[1] as
        | { level?: string | number; message?: string; sourceId?: string }
        | undefined
      if (details && typeof details === 'object') {
        consoleEntries.push({
          level: String(details.level ?? ''),
          message: String(details.message ?? ''),
          source: String(details.sourceId ?? '')
        })
      } else {
        consoleEntries.push({
          level: String(args[1] ?? ''),
          message: String(args[2] ?? ''),
          source: String(args[3] ?? '')
        })
      }
    })
    contents.on('preload-error', (_e, preloadPath, error) => {
      pageEvents.push(`preload-error ${preloadPath}: ${String(error)}`)
    })
    contents.on('did-fail-load', (_e, code, description, url) => {
      pageEvents.push(`did-fail-load ${code} ${description} ${url}`)
    })
    contents.on('render-process-gone', () => {
      pageEvents.push('render-process-gone')
    })
  })

  try {
    record('userData', app.getPath('userData'))
    const rawWindows = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    record('raw.windowSources', rawWindows.length)

    // Persistent observer window for state events.
    const observer = createWindow({ title: '[SR] 诊断观察', width: 480, height: 360 })
    allowWebContents(observer.webContents.id)
    loadPage(observer, 'mode')
    await waitForLoad(observer)
    await wait(900)
    await observer.webContents.executeJavaScript(
      `(() => { window.__diagStates = []; window.dsh.events.onState((state) => window.__diagStates.push(state)); return true })()`
    )

    const observerId = observer.webContents.id

    const clickButton = async (win: BrowserWindow, text: string): Promise<boolean> => {
      const clickPromise = win.webContents
        .executeJavaScript(
          `(() => {
            const button = [...document.querySelectorAll('button')].find((element) => element.textContent && element.textContent.includes(${JSON.stringify(text)}))
            if (!button) return false
            button.click()
            return true
          })()`,
          true
        )
        .catch(() => false)
      const result = await Promise.race([clickPromise, wait(1500).then(() => 'timeout')])
      return result === true
    }

    const clickRadio = async (win: BrowserWindow, value: string): Promise<boolean> =>
      Boolean(
        await win.webContents.executeJavaScript(
          `(() => {
            const input = document.querySelector('input[name="capture-mode"][value="${value}"]')
            if (!input) return false
            input.click()
            return true
          })()`,
          true
        )
      )

    const readStates = async (): Promise<string[]> =>
      (await observer.webContents.executeJavaScript('window.__diagStates.slice()')) as string[]

    // 1) Fullscreen flow through the real tray handler + UI buttons.
    ctx.showModeDialog()
    let modeWin = await waitForWindow('/mode/', 8000, observerId)
    record('flow.fullscreen.window', Boolean(modeWin))
    if (!modeWin) throw new Error('mode window did not open')
    await waitForLoad(modeWin)
    await wait(900)
    record(
      'flow.fullscreen.preload',
      await modeWin.webContents.executeJavaScript('typeof window.dsh')
    )
    await clickRadio(modeWin, 'fullscreen')
    await wait(200)
    record('flow.fullscreen.startClick', await clickButton(modeWin, '开始录制'))
    console.error('[diag] before wait after start')
    await wait(hold)
    console.error('[diag] after wait after start')
    record('flow.fullscreen.stateBeforeStop', ctx.getState())
    const fullscreenStop = await Promise.race([
      ctx.stopRecording(),
      wait(12000).then(() => 'stop-timeout')
    ])
    record('flow.fullscreen.stop', fullscreenStop)
    await wait(600)
    record('flow.fullscreen.states', await readStates())

    // 2) Window-mode flow: pick a listed window and start from the UI.
    ctx.showModeDialog()
    modeWin = await waitForWindow('/mode/', 8000, observerId)
    if (!modeWin) throw new Error('mode window did not open (window flow)')
    await waitForLoad(modeWin)
    await wait(900)
    await clickRadio(modeWin, 'window')
    await wait(1000)
    const windowItems = (await modeWin.webContents.executeJavaScript(
      'document.querySelectorAll(".window-item").length'
    )) as number
    record('flow.window.items', windowItems)
    if (windowItems > 0) {
      await modeWin.webContents.executeJavaScript(
        `document.querySelectorAll('.window-item')[0].click()`,
        true
      )
      await wait(300)
      record('flow.window.startClick', await clickButton(modeWin, '开始录制'))
      await wait(hold)
      const windowStop = await ctx.stopRecording()
      record('flow.window.stop', windowStop)
      await wait(600)
      record('flow.window.states', await readStates())
    }

    // 3) Region flow: open the overlay, drag with synthetic mouse input, then start.
    ctx.showModeDialog()
    modeWin = await waitForWindow('/mode/', 8000, observerId)
    if (!modeWin) throw new Error('mode window did not open (region flow)')
    await waitForLoad(modeWin)
    await wait(900)
    await clickRadio(modeWin, 'region')
    await wait(400)
    record('flow.region.pickClick', await clickButton(modeWin, '在屏幕上框选'))
    const overlay = await waitForWindow('/overlay/', 8000, observerId)
    record('flow.region.overlay', Boolean(overlay))
    if (overlay) {
      try {
        if (overlay.webContents.isLoading()) {
          await new Promise<void>((resolve) => {
            overlay.webContents.once('did-finish-load', () => resolve())
          })
        }
        await wait(400)
        record('flow.region.overlayReady', !overlay.webContents.isLoading())
        overlay.focus()
        await overlay.webContents.executeJavaScript(
          `(() => {
            const root = document.getElementById('overlay')
            if (!root) return false
            const fire = (target, type, x, y) => {
              target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
            }
            fire(root, 'mousedown', 40, 50)
            fire(window, 'mousemove', 680, 530)
            fire(window, 'mouseup', 680, 530)
            return true
          })()`,
          true
        )
      } catch (error) {
        recordError('flow.region.drag', error)
      }
      let regionValues: { width?: string; height?: string } | null = null
      let pickResult: unknown = null
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await wait(200)
        regionValues = (await modeWin.webContents.executeJavaScript(
          `(() => { const width = document.querySelector('#region-width'); const height = document.querySelector('#region-height'); return { width: width && width.value, height: height && height.value } })()`
        )) as { width?: string; height?: string }
        pickResult = await modeWin.webContents.executeJavaScript(
          'window.__lastRegionPick ?? null'
        )
        if (regionValues.width === '640' || pickResult) break
      }
      record('flow.region.values', regionValues)
      record('flow.region.pickResult', pickResult)
      record('flow.region.overlayClosed', overlay.isDestroyed())
      record('flow.region.startClick', await clickButton(modeWin, '开始录制'))
      await wait(hold)
      const regionStop = await ctx.stopRecording()
      record('flow.region.stop', regionStop)
      await wait(600)
      record('flow.region.states', await readStates())
    }

    // 4) Settings window through the tray handler, then save from the UI.
    ctx.showSettingsWindow()
    const settingsWin = await waitForWindow('/settings/', 8000, observerId)
    record('flow.settings.window', Boolean(settingsWin))
    if (settingsWin) {
      await waitForLoad(settingsWin)
      await wait(900)
      record('flow.settings.saveClick', await clickButton(settingsWin, '保存'))
      await wait(350)
      record(
        'flow.settings.readBack',
        await settingsWin.webContents.executeJavaScript('window.dsh.settings.get()')
      )
      await wait(900)
    }
  } catch (error) {
    recordError('diagnostics', error)
  }

  record('done', true)

  const output = {
    pid: process.pid,
    appPath: app.getAppPath(),
    steps,
    console: {
      total: consoleEntries.length,
      errors: consoleEntries
        .filter(
          (entry) =>
            entry.level === 'error' ||
            /Uncaught|TypeError|ReferenceError|Cannot read|Failed to load|ERR_/.test(entry.message)
        )
        .slice(0, 30),
      errorCount: consoleEntries.filter(
        (entry) =>
          entry.level === 'error' ||
          /Uncaught|TypeError|ReferenceError|Cannot read|Failed to load|ERR_/.test(entry.message)
      ).length
    },
    pageEvents
  }
  fs.writeFileSync(path.join(process.cwd(), 'diagnostic-result.json'), JSON.stringify(output, null, 2))
  app.quit()
}
