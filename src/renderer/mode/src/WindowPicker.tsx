import type { WindowSource } from '@shared/types'
import { Button } from '../../common/components'

interface WindowPickerProps {
  sources: WindowSource[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}

export function WindowPicker({
  sources,
  selectedId,
  loading,
  onSelect,
  onRefresh
}: WindowPickerProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="row">
        <span className="hint grow">
          {loading ? '正在扫描窗口…' : `共 ${sources.length} 个可录制窗口`}
        </span>
        <Button onClick={onRefresh} disabled={loading}>
          刷新
        </Button>
      </div>

      {sources.length === 0 && !loading ? (
        <div className="empty-state">
          没有找到可录制的窗口。请打开目标应用后点击「刷新」。
        </div>
      ) : (
        <div className="window-list" role="listbox" aria-label="可录制窗口">
          {sources.map((source) => {
            const selected = source.id === selectedId
            return (
              <div
                key={source.id}
                className={`window-item${selected ? ' selected' : ''}`}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(source.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(source.id)
                }}
              >
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt="" />
                ) : (
                  <div
                    style={{
                      width: '64px',
                      height: '36px',
                      borderRadius: '4px',
                      background: '#000'
                    }}
                  />
                )}
                <span className="window-name">{source.name}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
