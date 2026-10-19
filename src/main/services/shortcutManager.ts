import { globalShortcut } from 'electron'

/**
 * Owns the single global screenshot accelerator. Registration is best effort:
 * a shortcut may be taken by another application, so callers fall back or show
 * a clear error instead of crashing.
 */
export class ShortcutManager {
  private active: string | null = null

  constructor(private readonly onTrigger: () => void) {}

  getActive(): string | null {
    return this.active
  }

  register(shortcut: string): boolean {
    const accelerator = shortcut.trim()
    if (!accelerator) return false
    this.unregister()
    try {
      if (!globalShortcut.register(accelerator, this.onTrigger)) return false
      this.active = accelerator
      return true
    } catch {
      return false
    }
  }

  update(shortcut: string): boolean {
    const accelerator = shortcut.trim()
    if (this.active === accelerator) return true
    const previous = this.active
    this.unregister()
    if (this.register(accelerator)) return true
    if (previous) this.register(previous)
    return false
  }

  /** Tests availability without disturbing the currently active shortcut. */
  canRegister(shortcut: string): boolean {
    const accelerator = shortcut.trim()
    if (!accelerator) return false
    if (this.active === accelerator) return true
    try {
      if (!globalShortcut.register(accelerator, () => undefined)) return false
      globalShortcut.unregister(accelerator)
      return true
    } catch {
      return false
    }
  }

  unregister(): void {
    if (!this.active) return
    try {
      globalShortcut.unregister(this.active)
    } catch {
      // ignore: the accelerator may already have been released by the system
    }
    this.active = null
  }

  dispose(): void {
    this.unregister()
  }
}
