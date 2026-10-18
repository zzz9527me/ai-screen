import { describe, expect, it } from 'vitest'
import { filterWindowSources, shouldIncludeWindow } from '@shared/windowFilter'

const thumbnail = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAA' }
const emptyThumbnail = { isEmpty: () => true, toDataURL: () => '' }

describe('windowFilter', () => {
  it('keeps normal application windows with thumbnails', () => {
    const result = filterWindowSources([
      { id: 'window:1:0', name: '记事本', thumbnail, appIcon: null }
    ])
    expect(result).toEqual([
      {
        id: 'window:1:0',
        name: '记事本',
        thumbnailDataUrl: 'data:image/png;base64,AAA',
        appIconDataUrl: null
      }
    ])
  })

  it('excludes the application own windows', () => {
    const result = filterWindowSources([
      { id: 'window:2:0', name: '[SR] 录屏', thumbnail }
    ])
    expect(result).toEqual([])
    expect(shouldIncludeWindow('[SR] 设置')).toBe(false)
  })

  it('excludes empty titles', () => {
    expect(shouldIncludeWindow('')).toBe(false)
    expect(shouldIncludeWindow('   ')).toBe(false)
  })

  it('excludes known system shell windows', () => {
    expect(shouldIncludeWindow('Program Manager')).toBe(false)
    expect(shouldIncludeWindow('Windows 输入体验')).toBe(false)
  })

  it('excludes windows without thumbnails', () => {
    const result = filterWindowSources([
      { id: 'window:3:0', name: 'No thumb', thumbnail: emptyThumbnail }
    ])
    expect(result).toEqual([])
  })

  it('keeps the application icon when present', () => {
    const result = filterWindowSources([
      {
        id: 'window:4:0',
        name: 'App',
        thumbnail,
        appIcon: { toDataURL: () => 'data:image/png;base64,ICO' }
      }
    ])
    expect(result[0].appIconDataUrl).toBe('data:image/png;base64,ICO')
  })
})
