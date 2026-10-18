import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { settingsInputSchema, settingsSchema } from '@shared/schemas'
import type { Region, SaveResult, Settings, SettingsInput } from '@shared/types'
import { clampRegion } from './regionMath'

export interface DisplayMetrics {
  width: number
  height: number
  scaleFactor: number
}

export interface SettingsStoreDeps {
  userDataDir: string
  videosDir: string
  getPrimaryDisplay: () => DisplayMetrics
}

export const DEFAULT_REGION: Region = { x: 0, y: 0, width: 1280, height: 720 }

export function createDefaultSettings(deps: {
  videosDir: string
  display: DisplayMetrics
}): Settings {
  return {
    version: 1,
    storageDirectory: path.join(deps.videosDir, 'DSH Screen Recorder'),
    region: clampRegion(DEFAULT_REGION, deps.display),
    lastMode: 'fullscreen',
    updatedAt: new Date().toISOString()
  }
}

function formatIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.map((part) => String(part)).join('.') || 'settings',
    message: issue.message
  }))
}

/**
 * Persists user settings as zod-validated JSON using atomic writes (temp file +
 * rename). Corrupt or unknown-version files are backed up and reset.
 */
export class SettingsStore {
  private readonly filePath: string
  private cache: Settings | null = null

  constructor(private readonly deps: SettingsStoreDeps) {
    this.filePath = path.join(deps.userDataDir, 'settings.json')
  }

  get(): Settings {
    if (!this.cache) this.cache = this.load()
    return this.cache
  }

  save(input: SettingsInput): SaveResult {
    const parsedInput = settingsInputSchema.safeParse(input)
    if (!parsedInput.success) return { ok: false, errors: formatIssues(parsedInput.error) }

    const display = this.deps.getPrimaryDisplay()
    const current = this.get()
    const next: Settings = {
      ...current,
      ...parsedInput.data,
      region: parsedInput.data.region ?? current.region,
      updatedAt: new Date().toISOString()
    }

    if (!this.isRegionInside(next.region, display)) {
      return {
        ok: false,
        errors: [
          { field: 'region', message: '区域必须完全位于主显示器内,且宽高不小于 16×16 DIP' }
        ]
      }
    }
    if (!path.isAbsolute(next.storageDirectory)) {
      return { ok: false, errors: [{ field: 'storageDirectory', message: '存储位置必须是绝对路径' }] }
    }
    try {
      fs.mkdirSync(next.storageDirectory, { recursive: true })
    } catch {
      return { ok: false, errors: [{ field: 'storageDirectory', message: '无法创建存储目录' }] }
    }

    const validated = settingsSchema.safeParse(next)
    if (!validated.success) return { ok: false, errors: formatIssues(validated.error) }

    this.writeAtomic(validated.data)
    this.cache = validated.data
    return { ok: true, settings: validated.data }
  }

  private isRegionInside(region: Region, display: DisplayMetrics): boolean {
    return (
      region.width >= 16 &&
      region.height >= 16 &&
      region.x >= 0 &&
      region.y >= 0 &&
      region.x + region.width <= display.width &&
      region.y + region.height <= display.height
    )
  }

  private load(): Settings {
    try {
      if (!fs.existsSync(this.filePath)) return this.persistDefault()
      const raw: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      const parsed = settingsSchema.safeParse(raw)
      if (!parsed.success) return this.resetWithBackup()
      return parsed.data
    } catch {
      return this.resetWithBackup()
    }
  }

  private persistDefault(): Settings {
    const settings = createDefaultSettings({
      videosDir: this.deps.videosDir,
      display: this.deps.getPrimaryDisplay()
    })
    this.writeAtomic(settings)
    return settings
  }

  private resetWithBackup(): Settings {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, `${this.filePath}.bak-${Date.now()}`)
      }
    } catch {
      // Best effort: a stale backup must not block recovering defaults.
    }
    return this.persistDefault()
  }

  private writeAtomic(settings: Settings): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf8')
    fs.renameSync(tempPath, this.filePath)
  }
}
