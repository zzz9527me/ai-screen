import { describe, expect, it } from 'vitest'
import { clampRegion, isRegionValid, toPhysical } from '../../src/main/services/regionMath'

describe('regionMath', () => {
  const display = { width: 1920, height: 1080 }

  it('accepts a valid region inside the display', () => {
    expect(isRegionValid({ x: 100, y: 100, width: 640, height: 480 }, display)).toBe(true)
  })

  it('rejects regions smaller than 16x16 DIP', () => {
    expect(isRegionValid({ x: 0, y: 0, width: 15, height: 100 }, display)).toBe(false)
    expect(isRegionValid({ x: 0, y: 0, width: 100, height: 15 }, display)).toBe(false)
  })

  it('rejects regions outside the display bounds', () => {
    expect(isRegionValid({ x: 1900, y: 0, width: 100, height: 100 }, display)).toBe(false)
    expect(isRegionValid({ x: -1, y: 0, width: 100, height: 100 }, display)).toBe(false)
  })

  it('rejects non-integer coordinates', () => {
    expect(isRegionValid({ x: 1.5, y: 0, width: 100, height: 100 }, display)).toBe(false)
  })

  it('clamps oversized regions into the display', () => {
    expect(clampRegion({ x: 2000, y: 1200, width: 5000, height: 5000 }, display)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('keeps already valid regions unchanged', () => {
    const region = { x: 100, y: 100, width: 640, height: 480 }
    expect(clampRegion(region, display)).toEqual(region)
  })

  it('converts DIP to physical pixels with rounding', () => {
    expect(toPhysical({ x: 10, y: 20, width: 100, height: 50 }, 1.25)).toEqual({
      x: 13,
      y: 25,
      width: 125,
      height: 63
    })
  })
})
