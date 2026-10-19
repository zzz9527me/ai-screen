export const DEFAULT_SCREENSHOT_SHORTCUT = 'CommandOrControl+Shift+S'

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu'
])

export interface ShortcutKeyEvent {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  key: string
}

function normalizeKey(event: ShortcutKeyEvent): string | null {
  const raw = event.key
  if (!raw || MODIFIER_KEYS.has(raw)) return null
  if (raw === 'Escape' || raw === 'Esc') return null
  if (raw.length === 1) return raw === ' ' ? 'Space' : raw.toUpperCase()
  const alias = KEY_ALIASES[raw]
  if (alias) return alias
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(raw)) return raw
  return null
}

/** Builds an Electron accelerator such as `CommandOrControl+Shift+S`. */
export function acceleratorFromKeyEvent(event: ShortcutKeyEvent): string | null {
  const key = normalizeKey(event)
  if (!key) return null
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (modifiers.length === 0 && key !== 'PrintScreen') return null
  if (!event.ctrlKey && !event.metaKey && !event.altKey && key !== 'PrintScreen') return null
  return [...modifiers, key].join('+')
}

export function formatShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return 'Ctrl'
      if (part === 'Super' || part === 'Meta') return 'Win'
      return part
    })
    .join(' + ')
}
