import { describe, expect, it } from 'vitest'
import {
  acceleratorFromKeyEvent,
  DEFAULT_SCREENSHOT_SHORTCUT,
  formatShortcut
} from '../../src/shared/shortcut'

function keyEvent(overrides: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]> = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: '',
    ...overrides
  }
}

describe('shortcut', () => {
  it('builds Ctrl+Shift+S as CommandOrControl+Shift+S', () => {
    expect(
      acceleratorFromKeyEvent(keyEvent({ ctrlKey: true, shiftKey: true, key: 's' }))
    ).toBe('CommandOrControl+Shift+S')
    expect(
      acceleratorFromKeyEvent(keyEvent({ metaKey: true, shiftKey: true, key: 's' }))
    ).toBe('CommandOrControl+Shift+S')
  })

  it('supports Alt and function keys', () => {
    expect(acceleratorFromKeyEvent(keyEvent({ altKey: true, key: 'F5' }))).toBe('Alt+F5')
    expect(acceleratorFromKeyEvent(keyEvent({ ctrlKey: true, key: ' ' }))).toBe(
      'CommandOrControl+Space'
    )
  })

  it('rejects plain keys, shift-only combinations and Escape', () => {
    expect(acceleratorFromKeyEvent(keyEvent({ key: 's' }))).toBeNull()
    expect(acceleratorFromKeyEvent(keyEvent({ shiftKey: true, key: 's' }))).toBeNull()
    expect(acceleratorFromKeyEvent(keyEvent({ ctrlKey: true, key: 'Escape' }))).toBeNull()
  })

  it('allows PrintScreen alone and normalizes arrow keys', () => {
    expect(acceleratorFromKeyEvent(keyEvent({ key: 'PrintScreen' }))).toBe('PrintScreen')
    expect(acceleratorFromKeyEvent(keyEvent({ ctrlKey: true, key: 'ArrowUp' }))).toBe(
      'CommandOrControl+Up'
    )
  })

  it('formats accelerators for display', () => {
    expect(formatShortcut(DEFAULT_SCREENSHOT_SHORTCUT)).toBe('Ctrl + Shift + S')
  })
})
