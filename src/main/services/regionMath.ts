import type { Region } from '@shared/types'

export const MIN_REGION_SIZE = 16

export interface DisplaySize {
  width: number
  height: number
}

function isInteger(value: number): boolean {
  return Number.isInteger(value)
}

export function isRegionValid(region: Region, display: DisplaySize): boolean {
  if (
    !isInteger(region.x) ||
    !isInteger(region.y) ||
    !isInteger(region.width) ||
    !isInteger(region.height)
  ) {
    return false
  }
  if (region.width < MIN_REGION_SIZE || region.height < MIN_REGION_SIZE) return false
  if (region.x < 0 || region.y < 0) return false
  return region.x + region.width <= display.width && region.y + region.height <= display.height
}

export function clampRegion(region: Region, display: DisplaySize): Region {
  const width = Math.max(
    MIN_REGION_SIZE,
    Math.min(Math.round(region.width), Math.round(display.width))
  )
  const height = Math.max(
    MIN_REGION_SIZE,
    Math.min(Math.round(region.height), Math.round(display.height))
  )
  const x = Math.max(0, Math.min(Math.round(region.x), Math.round(display.width) - width))
  const y = Math.max(0, Math.min(Math.round(region.y), Math.round(display.height) - height))
  return { x, y, width, height }
}

/** Convert a DIP region into physical pixels for capture/encoding. */
export function toPhysical(region: Region, scaleFactor: number): Region {
  return {
    x: Math.round(region.x * scaleFactor),
    y: Math.round(region.y * scaleFactor),
    width: Math.round(region.width * scaleFactor),
    height: Math.round(region.height * scaleFactor)
  }
}
