import fs from 'node:fs'
import path from 'node:path'
import type { SessionMarker } from '@shared/types'

const MARKER_FILE = 'recording-session.json'

/**
 * Writes a marker while a recording is active and detects leftovers on the next
 * launch (process crash / forced kill). The marker itself never contains
 * recording content - only the path and timestamps.
 */
export class CrashRecovery {
  private readonly filePath: string

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, MARKER_FILE)
  }

  writeMarker(marker: SessionMarker): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(marker, null, 2), 'utf8')
  }

  clearMarker(): void {
    try {
      fs.rmSync(this.filePath, { force: true })
    } catch {
      // Best effort cleanup only.
    }
  }

  detectLeftover(): SessionMarker | null {
    try {
      if (!fs.existsSync(this.filePath)) return null
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<SessionMarker>
      this.clearMarker()
      if (
        typeof raw.id !== 'string' ||
        typeof raw.outputPath !== 'string' ||
        typeof raw.startedAt !== 'string' ||
        (raw.mode !== 'fullscreen' && raw.mode !== 'region' && raw.mode !== 'window')
      ) {
        return null
      }
      return {
        id: raw.id,
        outputPath: raw.outputPath,
        startedAt: raw.startedAt,
        mode: raw.mode
      }
    } catch {
      this.clearMarker()
      return null
    }
  }
}
