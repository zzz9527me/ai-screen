import { useEffect, useMemo, useState } from 'react'
import type { Region } from '@shared/types'
import { Button, NumberField } from '../../common/components'

interface RegionEditorProps {
  region: Region | null
  onChange: (region: Region) => void
  onPick: () => void
  onValidChange: (valid: boolean) => void
}

const FIELDS: Array<{ key: keyof Region; label: string }> = [
  { key: 'x', label: 'X(像素)' },
  { key: 'y', label: 'Y(像素)' },
  { key: 'width', label: '宽度' },
  { key: 'height', label: '高度' }
]

function regionToRaw(region: Region | null): Record<keyof Region, string> {
  return {
    x: String(region?.x ?? 0),
    y: String(region?.y ?? 0),
    width: String(region?.width ?? 1280),
    height: String(region?.height ?? 720)
  }
}

export function RegionEditor({
  region,
  onChange,
  onPick,
  onValidChange
}: RegionEditorProps): React.JSX.Element {
  const [raw, setRaw] = useState<Record<keyof Region, string>>(() => regionToRaw(region))

  const parsed = useMemo<Region | null>(() => {
    const values = FIELDS.map(({ key }) => Number(raw[key]))
    if (values.some((value) => !Number.isFinite(value) || !Number.isInteger(value))) return null
    const [x, y, width, height] = values
    if (x < 0 || y < 0 || width < 16 || height < 16) return null
    return { x, y, width, height }
  }, [raw])

  useEffect(() => {
    onValidChange(parsed !== null)
    if (!parsed) return
    if (
      region &&
      region.x === parsed.x &&
      region.y === parsed.y &&
      region.width === parsed.width &&
      region.height === parsed.height
    ) {
      return
    }
    onChange(parsed)
  }, [parsed, region, onChange, onValidChange])

  const update = (key: keyof Region) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setRaw((current) => ({ ...current, [key]: event.target.value }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="field-grid">
        {FIELDS.map(({ key, label }) => (
          <NumberField
            key={key}
            id={`region-${key}`}
            label={label}
            min={0}
            value={raw[key]}
            className={parsed ? '' : 'invalid'}
            onChange={update(key)}
          />
        ))}
      </div>
      {!parsed && (
        <p className="field error">区域无效:坐标不能为负,宽高至少 16(单位为 DIP)</p>
      )}
      <div className="row">
        <Button onClick={onPick}>在屏幕上框选</Button>
        <span className="hint">
          {region ? `当前区域 ${region.width}×${region.height}` : '尚未选择区域'}
        </span>
      </div>
    </div>
  )
}
