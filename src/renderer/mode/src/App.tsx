import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppState,
  CaptureMode,
  Region,
  Settings,
  StartCaptureRequest,
  WindowSource
} from '@shared/types'
import { RegionEditor } from './RegionEditor'
import { WindowPicker } from './WindowPicker'
import { Button } from '../../common/components'

const MODE_LABELS: Record<CaptureMode, { name: string; desc: string }> = {
  fullscreen: { name: '全屏', desc: '录制主显示器的全部内容' },
  region: { name: '选定区域', desc: '在屏幕上框选一块矩形区域' },
  window: { name: '指定应用窗口', desc: '只录制某个应用窗口的内容' }
}

const MODES: CaptureMode[] = ['fullscreen', 'region', 'window']

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [mode, setMode] = useState<CaptureMode>('fullscreen')
  const [region, setRegion] = useState<Region | null>(null)
  const [sources, setSources] = useState<WindowSource[]>([])
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null)
  const [loadingWindows, setLoadingWindows] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [regionEditorValid, setRegionEditorValid] = useState(true)
  const [regionRevision, setRegionRevision] = useState(0)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const value = await window.dsh.settings.get()
      if (disposed) return
      setSettings(value)
      setMode(value.lastMode)
      setRegion(value.region)
    })()
    const offState = window.dsh.events.onState((state: AppState) => {
      if (state === 'idle') setBusy(false)
      if (state === 'recording') setBusy(false)
    })
    const offError = window.dsh.events.onError((message) => setError(message))
    return () => {
      disposed = true
      offState()
      offError()
    }
  }, [])

  const refreshWindows = useCallback(async () => {
    setLoadingWindows(true)
    const result = await window.dsh.windows.list()
    setLoadingWindows(false)
    if (result.ok) {
      setSources(result.sources)
      setSelectedWindowId((current) =>
        current && result.sources.some((source) => source.id === current) ? current : null
      )
    } else {
      setError(result.message)
    }
  }, [])

  useEffect(() => {
    if (mode === 'window') void refreshWindows()
  }, [mode, refreshWindows])

  const pickRegion = useCallback(async () => {
    setError(null)
    const result = await window.dsh.region.pick()
    ;(window as unknown as { __lastRegionPick?: unknown }).__lastRegionPick = result
    if (result.ok) {
      setRegion(result.rect)
      setRegionRevision((revision) => revision + 1)
      return
    }
    if ('cancelled' in result && result.cancelled) return
    setError('message' in result ? result.message : '区域选择失败')
  }, [])

  const regionValid =
    regionEditorValid && !!region && region.width >= 16 && region.height >= 16
  const canStart =
    !busy &&
    (mode === 'fullscreen' ||
      (mode === 'region' && regionValid) ||
      (mode === 'window' && !!selectedWindowId))

  const handleStart = useCallback(async () => {
    setError(null)
    setBusy(true)
    let request: StartCaptureRequest
    if (mode === 'fullscreen') {
      request = { mode: 'fullscreen' }
    } else if (mode === 'region') {
      if (!region) {
        setError('请先框选有效区域')
        setBusy(false)
        return
      }
      request = { mode: 'region', region }
    } else {
      const source = sources.find((item) => item.id === selectedWindowId)
      if (!source) {
        setError('请选择要录制的窗口')
        setBusy(false)
        return
      }
      request = { mode: 'window', windowSourceId: source.id, windowName: source.name }
    }

    const result = await window.dsh.capture.start(request)
    if (!result.ok) {
      setError(result.message)
      setBusy(false)
      return
    }
    window.dsh.dialog.close()
  }, [mode, region, sources, selectedWindowId])

  const handleCancel = useCallback(() => {
    window.dsh.dialog.close()
  }, [])

  const lastModeHint = useMemo(
    () => (settings ? `默认模式:${MODE_LABELS[settings.lastMode].name}` : ''),
    [settings]
  )

  return (
    <div className="app">
      <header className="app-header">
        <h1>开始录制</h1>
        <p>{lastModeHint}</p>
      </header>

      <section className="section">
        <h2 className="section-title">录制模式</h2>
        <div className="mode-list" role="radiogroup" aria-label="录制模式">
          {MODES.map((item) => {
            const selected = mode === item
            return (
              <label
                key={item}
                className={`mode-option${selected ? ' selected' : ''}`}
                role="radio"
                aria-checked={selected}
              >
                <input
                  type="radio"
                  name="capture-mode"
                  value={item}
                  checked={selected}
                  onChange={() => setMode(item)}
                />
                <span>
                  <span className="mode-name">{MODE_LABELS[item].name}</span>
                  <span className="mode-desc" style={{ display: 'block' }}>
                    {MODE_LABELS[item].desc}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </section>

      {mode === 'region' && (
        <section className="section">
          <h2 className="section-title">录制区域</h2>
          <RegionEditor
            key={regionRevision}
            region={region}
            onChange={setRegion}
            onPick={pickRegion}
            onValidChange={setRegionEditorValid}
          />
        </section>
      )}

      {mode === 'window' && (
        <section className="section">
          <h2 className="section-title">选择窗口</h2>
          <WindowPicker
            sources={sources}
            selectedId={selectedWindowId}
            loading={loadingWindows}
            onSelect={setSelectedWindowId}
            onRefresh={refreshWindows}
          />
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="btn-row">
        <Button variant="ghost" onClick={handleCancel}>
          取消
        </Button>
        <Button variant="primary" disabled={!canStart} onClick={handleStart}>
          {busy ? '正在启动…' : '开始录制'}
        </Button>
      </div>
    </div>
  )
}
