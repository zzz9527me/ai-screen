import { describe, expect, it } from 'vitest'
import { MP4_MIME_CANDIDATES, pickSupportedMime } from '@shared/mime'

describe('mime', () => {
  it('prefers the first supported candidate in order', () => {
    expect(pickSupportedMime((mime) => mime.includes('avc1'))).toBe(
      'video/mp4;codecs=avc1.42001F'
    )
  })

  it('falls back to the plain mp4 container', () => {
    expect(pickSupportedMime((mime) => mime === 'video/mp4')).toBe('video/mp4')
  })

  it('returns null when no candidate is supported', () => {
    expect(pickSupportedMime(() => false)).toBeNull()
  })

  it('exposes an ordered candidate list', () => {
    expect(MP4_MIME_CANDIDATES[0]).toBe('video/mp4;codecs=avc1.42001F')
    expect(MP4_MIME_CANDIDATES[MP4_MIME_CANDIDATES.length - 1]).toBe('video/mp4')
  })
})
