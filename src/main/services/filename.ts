import fs from 'node:fs'
import path from 'node:path'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '_' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

export function buildFileName(date: Date): string {
  return `ScreenRecording_${formatTimestamp(date)}.mp4`
}

export interface UniquePathOptions {
  exists?: (candidate: string) => boolean | Promise<boolean>
}

export async function uniqueFilePath(
  directory: string,
  date: Date,
  options: UniquePathOptions = {}
): Promise<string> {
  const exists = options.exists ?? ((candidate: string) => fs.existsSync(candidate))
  const stamp = formatTimestamp(date)
  let counter = 0
  for (;;) {
    const suffix = counter === 0 ? '' : `_${counter}`
    const candidate = path.join(directory, `ScreenRecording_${stamp}${suffix}.mp4`)
    if (!(await exists(candidate))) return candidate
    counter += 1
  }
}

export function buildScreenshotFileName(date: Date): string {
  return `Screenshot_${formatTimestamp(date)}.png`
}

export async function uniqueScreenshotPath(
  directory: string,
  date: Date,
  options: UniquePathOptions = {}
): Promise<string> {
  const exists = options.exists ?? ((candidate: string) => fs.existsSync(candidate))
  const stamp = formatTimestamp(date)
  let counter = 0
  for (;;) {
    const suffix = counter === 0 ? '' : `_${counter}`
    const candidate = path.join(directory, `Screenshot_${stamp}${suffix}.png`)
    if (!(await exists(candidate))) return candidate
    counter += 1
  }
}
