import fs from 'node:fs/promises'

export interface Mp4CheckResult {
  ok: boolean
  reason?: string
  size?: number
}

const MIN_MP4_SIZE = 1024
const FTYP_SEARCH_WINDOW = 32

/**
 * Cheap sanity check for a finalized MP4: non-trivial size and an `ftyp` box
 * near the start of the file. Catches truncated/never-finalized recordings.
 */
export async function checkMp4File(filePath: string): Promise<Mp4CheckResult> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return { ok: false, reason: '文件不存在' }
  }
  if (!stat.isFile()) return { ok: false, reason: '路径不是文件', size: stat.size }
  if (stat.size < MIN_MP4_SIZE) {
    return { ok: false, reason: `文件过小(${stat.size} 字节)`, size: stat.size }
  }

  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(64)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const header = buffer.subarray(0, bytesRead)
    const index = header.indexOf(Buffer.from('ftyp'))
    if (index < 0 || index > FTYP_SEARCH_WINDOW) {
      return { ok: false, reason: '缺少 MP4 ftyp 头', size: stat.size }
    }
    return { ok: true, size: stat.size }
  } finally {
    await handle.close()
  }
}

export async function isMp4File(filePath: string): Promise<boolean> {
  return (await checkMp4File(filePath)).ok
}
