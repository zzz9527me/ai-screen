import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SCREENSHOT_SHORTCUT } from '../../src/shared/shortcut'
import { SettingsStore } from '../../src/main/services/settingsStore'

const roots: string[] = []
const display = { width: 1920, height: 1080, scaleFactor: 1 }

function setup(): {
  userDataDir: string
  videosDir: string
  createStore: () => SettingsStore
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-settings-'))
  roots.push(root)
  const userDataDir = path.join(root, 'userData')
  const videosDir = path.join(root, 'videos')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(videosDir, { recursive: true })
  const createStore = (): SettingsStore =>
    new SettingsStore({ userDataDir, videosDir, getPrimaryDisplay: () => display })
  return { userDataDir, videosDir, createStore }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('creates defaults on first run', () => {
    const { userDataDir, videosDir, createStore } = setup()
    const settings = createStore().get()
    expect(settings.version).toBe(1)
    expect(settings.storageDirectory).toBe(path.join(videosDir, 'DSH Screen Recorder'))
    expect(settings.region).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
    expect(settings.lastMode).toBe('fullscreen')
    expect(settings.screenshotShortcut).toBe(DEFAULT_SCREENSHOT_SHORTCUT)
    expect(fs.existsSync(path.join(userDataDir, 'settings.json'))).toBe(true)
  })

  it('migrates old settings without a screenshot shortcut', () => {
    const { userDataDir, videosDir, createStore } = setup()
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({
        version: 1,
        storageDirectory: path.join(videosDir, 'legacy'),
        region: { x: 0, y: 0, width: 800, height: 600 },
        lastMode: 'fullscreen',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      'utf8'
    )
    const settings = createStore().get()
    expect(settings.storageDirectory).toBe(path.join(videosDir, 'legacy'))
    expect(settings.screenshotShortcut).toBe(DEFAULT_SCREENSHOT_SHORTCUT)
  })

  it('persists valid changes and reloads them', () => {
    const { videosDir, createStore } = setup()
    const target = path.join(videosDir, 'custom')
    const result = createStore().save({
      storageDirectory: target,
      region: { x: 10, y: 20, width: 800, height: 600 }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.storageDirectory).toBe(target)

    const reloaded = createStore().get()
    expect(reloaded.storageDirectory).toBe(target)
    expect(reloaded.region).toEqual({ x: 10, y: 20, width: 800, height: 600 })
  })

  it('rejects regions outside the primary display', () => {
    const { createStore } = setup()
    const result = createStore().save({ region: { x: 1800, y: 0, width: 500, height: 100 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].field).toBe('region')
  })

  it('rejects regions below the minimum size', () => {
    const { createStore } = setup()
    const result = createStore().save({ region: { x: 0, y: 0, width: 15, height: 100 } })
    expect(result.ok).toBe(false)
  })

  it('rejects relative storage paths', () => {
    const { createStore } = setup()
    const result = createStore().save({ storageDirectory: 'relative/path' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].field).toBe('storageDirectory')
  })

  it('backs up a corrupt settings file and resets to defaults', () => {
    const { userDataDir, videosDir, createStore } = setup()
    fs.writeFileSync(path.join(userDataDir, 'settings.json'), '{ not json', 'utf8')
    const settings = createStore().get()
    expect(settings.storageDirectory).toBe(path.join(videosDir, 'DSH Screen Recorder'))
    const files = fs.readdirSync(userDataDir)
    expect(files.some((name) => name.startsWith('settings.json.bak-'))).toBe(true)
  })

  it('clamps the default region when the display is smaller', () => {
    const { userDataDir, videosDir } = setup()
    const store = new SettingsStore({
      userDataDir,
      videosDir,
      getPrimaryDisplay: () => ({ width: 1024, height: 600, scaleFactor: 1 })
    })
    expect(store.get().region).toEqual({ x: 0, y: 0, width: 1024, height: 600 })
  })
})
