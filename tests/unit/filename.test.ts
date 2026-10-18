import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  buildFileName,
  formatTimestamp,
  uniqueFilePath
} from '../../src/main/services/filename'

describe('filename', () => {
  const date = new Date(2026, 2, 4, 5, 6, 7)

  it('formats timestamps as YYYYMMDD_HHmmss', () => {
    expect(formatTimestamp(date)).toBe('20260304_050607')
  })

  it('builds a ScreenRecording mp4 file name', () => {
    expect(buildFileName(date)).toBe('ScreenRecording_20260304_050607.mp4')
  })

  it('returns the base path when no file exists', async () => {
    const result = await uniqueFilePath('/out', date, { exists: () => false })
    expect(result).toBe(path.join('/out', 'ScreenRecording_20260304_050607.mp4'))
  })

  it('appends suffixes until a free name is found', async () => {
    const taken = new Set([
      path.join('/out', 'ScreenRecording_20260304_050607.mp4'),
      path.join('/out', 'ScreenRecording_20260304_050607_1.mp4')
    ])
    const result = await uniqueFilePath('/out', date, { exists: (candidate) => taken.has(candidate) })
    expect(result).toBe(path.join('/out', 'ScreenRecording_20260304_050607_2.mp4'))
  })
})
