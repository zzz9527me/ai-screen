import { OWN_WINDOW_PREFIX, type WindowSource } from './types'

const SYSTEM_WINDOW_TITLES = new Set([
  'Program Manager',
  'Windows 输入体验',
  'Microsoft Text Input Application',
  'Windows Shell Experience Host'
])

export interface SourceLike {
  id: string
  name: string
  thumbnail?: { isEmpty(): boolean; toDataURL(): string } | null
  appIcon?: { toDataURL(): string } | null
}

export function shouldIncludeWindow(name: string, hasThumbnail = true): boolean {
  const title = name.trim()
  if (!title) return false
  if (title.startsWith(OWN_WINDOW_PREFIX)) return false
  if (SYSTEM_WINDOW_TITLES.has(title)) return false
  return hasThumbnail
}

export function filterWindowSources(sources: SourceLike[]): WindowSource[] {
  const result: WindowSource[] = []
  for (const source of sources) {
    const thumbnail = source.thumbnail ?? null
    const hasThumbnail = thumbnail ? !thumbnail.isEmpty() : true
    if (!shouldIncludeWindow(source.name, hasThumbnail)) continue
    result.push({
      id: source.id,
      name: source.name.trim(),
      thumbnailDataUrl: thumbnail ? thumbnail.toDataURL() : '',
      appIconDataUrl: source.appIcon ? source.appIcon.toDataURL() : null
    })
  }
  return result
}
