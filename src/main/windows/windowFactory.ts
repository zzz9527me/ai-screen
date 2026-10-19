import { BrowserWindow, type WebPreferences } from 'electron'
import path from 'node:path'

export interface CreateWindowOptions {
  title: string
  width: number
  height: number
  x?: number
  y?: number
  resizable?: boolean
  frame?: boolean
  transparent?: boolean
  alwaysOnTop?: boolean
  skipTaskbar?: boolean
  fullscreen?: boolean
  backgroundColor?: string
  useContentSize?: boolean
  webPreferences?: WebPreferences
}

export function secureWebPreferences(overrides: WebPreferences = {}): WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    ...overrides
  }
}

export function applyNavigationGuards(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function createWindow(options: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    x: options.x,
    y: options.y,
    show: false,
    resizable: options.resizable ?? false,
    frame: options.frame ?? true,
    transparent: options.transparent ?? false,
    alwaysOnTop: options.alwaysOnTop ?? false,
    skipTaskbar: options.skipTaskbar ?? false,
    fullscreen: options.fullscreen ?? false,
    backgroundColor: options.backgroundColor ?? '#141414',
    useContentSize: options.useContentSize ?? false,
    webPreferences: secureWebPreferences(options.webPreferences)
  })
  applyNavigationGuards(win)
  if (options.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')
  return win
}

export function loadPage(
  win: BrowserWindow,
  page: 'mode' | 'settings' | 'overlay' | 'capture' | 'screenshot' | 'pin',
  query?: Record<string, string>
): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    void win.loadURL(`${devUrl}/${page}/index.html${search}`)
    return
  }
  void win.loadFile(path.join(__dirname, `../renderer/${page}/index.html`), query ? { query } : undefined)
}

export function showWhenReady(win: BrowserWindow): void {
  win.once('ready-to-show', () => win.show())
}
