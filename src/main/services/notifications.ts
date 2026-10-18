import { Notification } from 'electron'
import type { SessionMarker } from '@shared/types'

export function showNotification(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false
  new Notification({ title, body }).show()
  return true
}

export function showSaveNotification(filePath: string): boolean {
  return showNotification('DSH 屏幕录制器', `录制已保存:\n${filePath}`)
}

export function showErrorNotification(message: string): boolean {
  return showNotification('DSH 屏幕录制器 - 错误', message)
}

export function showRecoveryNotification(marker: SessionMarker): boolean {
  const name = marker.outputPath.split(/[\\/]/).pop() ?? marker.outputPath
  return showNotification(
    '上次录制可能未完成',
    `文件: ${name}\n该文件可能不完整,请检查后使用。`
  )
}
