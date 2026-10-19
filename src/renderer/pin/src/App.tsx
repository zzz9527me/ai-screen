import { useEffect, useState } from 'react'
import type { ScreenshotImagePayload } from '@shared/types'

export function App(): React.JSX.Element {
  const [image, setImage] = useState<ScreenshotImagePayload | null>(null)

  useEffect(() => window.dsh.screenshot.onImage((payload) => setImage(payload)), [])

  return (
    <div
      className="pin-window"
      onDoubleClick={() => window.dsh.dialog.close()}
      title="拖动移动,双击关闭"
    >
      {image ? (
        <img src={image.dataUrl} alt="贴图" draggable={false} />
      ) : (
        <div className="pin-loading">正在加载贴图…</div>
      )}
      <button
        type="button"
        className="pin-close"
        title="关闭贴图"
        onClick={() => window.dsh.dialog.close()}
      >
        ×
      </button>
    </div>
  )
}
