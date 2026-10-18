import { desktopCapturer, screen } from 'electron'
import type { WindowSource } from '@shared/types'
import { filterWindowSources } from '@shared/windowFilter'

export { filterWindowSources, shouldIncludeWindow } from '@shared/windowFilter'

export async function listWindowSources(): Promise<WindowSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  return filterWindowSources(sources)
}

export async function getPrimaryScreenSource(): Promise<Electron.DesktopCapturerSource | undefined> {
  const primary = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  })
  return sources.find((source) => source.display_id === String(primary.id)) ?? sources[0]
}

export async function findSourceById(
  sourceId: string
): Promise<Electron.DesktopCapturerSource | undefined> {
  const types: Array<'screen' | 'window'> = sourceId.startsWith('window:')
    ? ['window']
    : ['screen']
  const sources = await desktopCapturer.getSources({
    types,
    thumbnailSize: { width: 0, height: 0 }
  })
  return sources.find((source) => source.id === sourceId)
}
