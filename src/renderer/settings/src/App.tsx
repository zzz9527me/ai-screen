import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Region, Settings } from '@shared/types'
import {
  acceleratorFromKeyEvent,
  DEFAULT_SCREENSHOT_SHORTCUT,
  formatShortcut
} from '@shared/shortcut'
import { Button, NumberField } from '../../common/components'

const FIELDS: Array<{ key: keyof Region; label: string }> = [
  { key: 'x', label: 'X(像素)' },
  { key: 'y', label: 'Y(像素)' },
  { key: 'width', label: '宽度' },
  { key: 'height', label: '高度' }
]

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [storage, setStorage] = useState('')
  const [raw, setRaw] = useState<Record<keyof Region, string>>({
    x: '0',
    y: '0',
    width: '1280',
    height: '720'
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shortcut, setShortcut] = useState(DEFAULT_SCREENSHOT_SHORTCUT)
  const [capturingShortcut, setCapturingShortcut] = useState(false)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const value = await window.dsh.settings.get()
      if (disposed) return
      setSettings(value)
      setStorage(value.storageDirectory)
      setShortcut(value.screenshotShortcut)
      setRaw({
        x: String(value.region.x),
        y: String(value.region.y),
        width: String(value.region.width),
        height: String(value.region.height)
      })
    })()
    const offError = window.dsh.events.onError((message) => setErrors({ general: message }))
    return () => {
      disposed = true
      offError()
    }
  }, [])

  const parsedRegion = useMemo<Region | null>(() => {
    const values = FIELDS.map(({ key }) => Number(raw[key]))
    if (values.some((value) => !Number.isFinite(value) || !Number.isInteger(value))) return null
    const [x, y, width, height] = values
    if (x < 0 || y < 0 || width < 16 || height < 16) return null
    return { x, y, width, height }
  }, [raw])

  const update = (key: keyof Region) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setRaw((current) => ({ ...current, [key]: event.target.value }))
  }

  const browse = useCallback(async () => {
    const result = await window.dsh.settings.pickFolder()
    if (result.path) setStorage(result.path)
  }, [])

  const save = useCallback(async () => {
    setErrors({})
    setSaved(false)
    if (!parsedRegion) {
      setErrors({ region: '区域无效:坐标不能为负,宽高至少为 16(单位 DIP)' })
      return
    }
    if (!storage.trim()) {
      setErrors({ storageDirectory: '请填写存储位置' })
      return
    }
    if (!shortcut.trim()) {
      setErrors({ screenshotShortcut: '请设置截屏快捷键' })
      return
    }
    setBusy(true)
    const result = await window.dsh.settings.save({
      storageDirectory: storage.trim(),
      region: parsedRegion,
      lastMode: settings?.lastMode,
      screenshotShortcut: shortcut
    })
    setBusy(false)
    if (!result.ok) {
      const next: Record<string, string> = {}
      for (const item of result.errors) next[item.field] = item.message
      setErrors(next)
      return
    }
    setSettings(result.settings)
    setSaved(true)
    window.setTimeout(() => window.dsh.dialog.close(), 600)
  }, [parsedRegion, settings?.lastMode, shortcut, storage])

  const handleShortcutKey = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setCapturingShortcut(false)
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      setShortcut(DEFAULT_SCREENSHOT_SHORTCUT)
      setErrors((current) => {
        const next = { ...current }
        delete next.screenshotShortcut
        return next
      })
      return
    }
    const accelerator = acceleratorFromKeyEvent(event)
    if (!accelerator) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setErrors((current) => ({
          ...current,
          screenshotShortcut: '快捷键至少需要 Ctrl 或 Alt(Shift 可组合使用)'
        }))
      }
      return
    }
    event.preventDefault()
    setShortcut(accelerator)
    setCapturingShortcut(false)
    setErrors((current) => {
      const next = { ...current }
      delete next.screenshotShortcut
      return next
    })
    event.currentTarget.blur()
  }, [])

  const close = useCallback(() => {
    window.dsh.dialog.close()
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>设置</h1>
        <p>配置录制区域、存储位置与截屏快捷键,保存后立即生效。</p>
      </header>

      <section className="section">
        <h2 className="section-title">录制区域(DIP)</h2>
        <div className="field-grid">
          {FIELDS.map(({ key, label }) => (
            <NumberField
              key={key}
              id={`settings-region-${key}`}
              label={label}
              min={0}
              value={raw[key]}
              onChange={update(key)}
              className={parsedRegion ? '' : 'invalid'}
            />
          ))}
        </div>
        {errors.region && <p className="field error">{errors.region}</p>}
        <p className="hint">区域单位与 Windows 显示缩放无关(设备无关像素),范围须在主显示器内。</p>
      </section>

      <section className="section">
        <h2 className="section-title">截屏</h2>
        <div className="field">
          <label htmlFor="settings-screenshot-shortcut">截屏快捷键</label>
          <input
            id="settings-screenshot-shortcut"
            type="text"
            readOnly
            value={capturingShortcut ? '请按下组合键…' : formatShortcut(shortcut)}
            onFocus={() => setCapturingShortcut(true)}
            onBlur={() => setCapturingShortcut(false)}
            onKeyDown={handleShortcutKey}
            style={{ fontFamily: 'Consolas, monospace', letterSpacing: '0.5px' }}
          />
          {errors.screenshotShortcut && (
            <p className="field error">{errors.screenshotShortcut}</p>
          )}
          <p className="hint">
            点击输入框后按下组合键(至少包含 Ctrl 或 Alt,Shift 可组合);退格恢复默认,Esc 取消。触发截屏后先在屏幕上拖动框选区域。
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">存储位置</h2>
        <div className="field">
          <label htmlFor="settings-storage">录制文件保存目录</label>
          <div className="row">
            <input
              id="settings-storage"
              className="grow"
              type="text"
              value={storage}
              onChange={(event) => setStorage(event.target.value)}
            />
            <Button onClick={browse}>浏览…</Button>
          </div>
          {errors.storageDirectory && <p className="field error">{errors.storageDirectory}</p>}
        </div>
      </section>

      {errors.general && <div className="error-banner">{errors.general}</div>}
      {saved && <p className="hint">设置已保存</p>}

      <div className="btn-row">
        <Button variant="ghost" onClick={close}>
          取消
        </Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? '正在保存…' : '保存'}
        </Button>
      </div>
    </div>
  )
}
