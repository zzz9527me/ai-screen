import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CrashRecovery } from '../../src/main/services/crashRecovery'

const dirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-crash-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('CrashRecovery', () => {
  it('detects and clears a leftover marker', () => {
    const dir = makeDir()
    const recovery = new CrashRecovery(dir)
    recovery.writeMarker({
      id: 'session-1',
      outputPath: path.join(dir, 'recording.mp4'),
      startedAt: '2026-01-01T00:00:00.000Z',
      mode: 'fullscreen'
    })
    expect(fs.existsSync(path.join(dir, 'recording-session.json'))).toBe(true)

    const leftover = recovery.detectLeftover()
    expect(leftover?.id).toBe('session-1')
    expect(leftover?.mode).toBe('fullscreen')
    expect(fs.existsSync(path.join(dir, 'recording-session.json'))).toBe(false)
  })

  it('returns null when there is no marker', () => {
    expect(new CrashRecovery(makeDir()).detectLeftover()).toBeNull()
  })

  it('clears a malformed marker', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, 'recording-session.json'), '{ not json', 'utf8')
    expect(new CrashRecovery(dir).detectLeftover()).toBeNull()
    expect(fs.existsSync(path.join(dir, 'recording-session.json'))).toBe(false)
  })
})
