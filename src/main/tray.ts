import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'

export interface TrayHandlers {
  onRecord(): void
  onSettings(): void
  onStop(): void
  onQuit(): void
}

type TrayState = 'idle' | 'recording'

function loadIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico')
  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? nativeImage.createEmpty() : image
}

export class AppTray {
  private tray: Tray | null = null
  private state: TrayState = 'idle'

  constructor(private readonly handlers: TrayHandlers) {}

  create(): void {
    this.tray = new Tray(loadIcon())
    this.tray.setToolTip('DSH 屏幕录制器')
    this.rebuildMenu()
    this.tray.on('double-click', () => this.handlers.onRecord())
  }

  setRecordingState(recording: boolean): void {
    this.state = recording ? 'recording' : 'idle'
    this.rebuildMenu()
    this.tray?.setToolTip(recording ? 'DSH 屏幕录制器 - 正在录制' : 'DSH 屏幕录制器')
  }

  setTooltip(text: string): void {
    this.tray?.setToolTip(text)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private rebuildMenu(): void {
    const items: Electron.MenuItemConstructorOptions[] =
      this.state === 'recording'
        ? [{ label: '停止录制', click: () => this.handlers.onStop() }]
        : [{ label: '录屏', click: () => this.handlers.onRecord() }]

    items.push(
      { label: '设置', click: () => this.handlers.onSettings() },
      { type: 'separator' },
      { label: '退出', click: () => this.handlers.onQuit() }
    )
    this.tray?.setContextMenu(Menu.buildFromTemplate(items))
  }
}
