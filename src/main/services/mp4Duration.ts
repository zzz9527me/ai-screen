import { open } from 'node:fs/promises'

export interface DurationPatchResult {
  patched: boolean
  durationMs: number
}

interface Box {
  type: string
  offset: number
  size: number
  headerSize: number
}

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > end) break
      size = Number(buf.readBigUInt64BE(offset + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) break
    boxes.push({ type, offset, size, headerSize })
    offset += size
  }
  return boxes
}

function childBox(buf: Buffer, parent: Box, type: string): Box | undefined {
  return readBoxes(buf, parent.offset + parent.headerSize, parent.offset + parent.size).find(
    (box) => box.type === type
  )
}

function fullBox(buf: Buffer, box: Box): { version: number; flags: number; payload: number } {
  return {
    version: buf[box.offset + box.headerSize],
    flags: buf.readUIntBE(box.offset + box.headerSize + 1, 3),
    payload: box.offset + box.headerSize + 4
  }
}

interface DurationField {
  version: number
  duration: number
  durationOffset: number
}

function readMvhd(buf: Buffer, box: Box): { timescale: number } & DurationField {
  const { version, payload } = fullBox(buf, box)
  return version === 1
    ? {
        version,
        timescale: buf.readUInt32BE(payload + 16),
        duration: Number(buf.readBigUInt64BE(payload + 20)),
        durationOffset: payload + 20
      }
    : {
        version,
        timescale: buf.readUInt32BE(payload + 8),
        duration: buf.readUInt32BE(payload + 12),
        durationOffset: payload + 12
      }
}

function readTkhd(buf: Buffer, box: Box): DurationField {
  const { version, payload } = fullBox(buf, box)
  return version === 1
    ? {
        version,
        duration: Number(buf.readBigUInt64BE(payload + 24)),
        durationOffset: payload + 24
      }
    : {
        version,
        duration: buf.readUInt32BE(payload + 16),
        durationOffset: payload + 16
      }
}

function readMdhd(
  buf: Buffer,
  box: Box
): { timescale: number; duration: number; durationOffset: number; version: number } {
  const { version, payload } = fullBox(buf, box)
  return version === 1
    ? {
        version,
        timescale: buf.readUInt32BE(payload + 16),
        duration: Number(buf.readBigUInt64BE(payload + 20)),
        durationOffset: payload + 20
      }
    : {
        version,
        timescale: buf.readUInt32BE(payload + 8),
        duration: buf.readUInt32BE(payload + 12),
        durationOffset: payload + 12
      }
}

function tfhdDefaults(buf: Buffer, box: Box): { defaultDuration: number } {
  const { flags, payload } = fullBox(buf, box)
  let cursor = payload + 4 // track_ID
  if (flags & 0x1) cursor += 8
  if (flags & 0x2) cursor += 4
  const defaultDuration = flags & 0x8 ? buf.readUInt32BE(cursor) : 0
  return { defaultDuration }
}

function tfdtValue(buf: Buffer, box: Box): number {
  const { version, payload } = fullBox(buf, box)
  return version === 1 ? Number(buf.readBigUInt64BE(payload)) : buf.readUInt32BE(payload)
}

function trunDuration(buf: Buffer, box: Box, defaultDuration: number): number {
  const { flags, payload } = fullBox(buf, box)
  const sampleCount = buf.readUInt32BE(payload)
  let cursor = payload + 4
  if (flags & 0x1) cursor += 4
  if (flags & 0x4) cursor += 4
  let total = 0
  for (let index = 0; index < sampleCount; index += 1) {
    if (flags & 0x100) {
      total += buf.readUInt32BE(cursor)
      cursor += 4
    } else {
      total += defaultDuration
    }
    if (flags & 0x200) cursor += 4
    if (flags & 0x400) cursor += 4
    if (flags & 0x800) cursor += 4
  }
  return total
}

function writeDuration(buf: Buffer, field: DurationField, value: number): void {
  if (field.version === 1) {
    buf.writeBigUInt64BE(BigInt(Math.round(value)), field.durationOffset)
  } else {
    buf.writeUInt32BE(Math.round(value), field.durationOffset)
  }
}

async function readRange(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  length: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, offset)
  return buffer.subarray(0, bytesRead)
}

/**
 * MediaRecorder emits fragmented MP4 with zero duration in mvhd/tkhd/mdhd,
 * which makes Windows Explorer and some players show no duration. The real
 * duration is encoded in the moof fragments, so compute it from tfdt/trun and
 * write it back into the movie/track headers (file size is unchanged).
 */
export async function patchMp4Duration(filePath: string): Promise<DurationPatchResult> {
  const handle = await open(filePath, 'r+')
  try {
    const fileSize = (await handle.stat()).size
    const topLevel: Box[] = []
    let offset = 0
    while (offset + 8 <= fileSize) {
      const header = await readRange(handle, offset, 16)
      if (header.length < 8) break
      let size = header.readUInt32BE(0)
      const type = header.toString('ascii', 4, 8)
      let headerSize = 8
      if (size === 1) {
        if (header.length < 16) break
        size = Number(header.readBigUInt64BE(8))
        headerSize = 16
      } else if (size === 0) {
        size = fileSize - offset
      }
      if (size < headerSize || offset + size > fileSize) break
      topLevel.push({ type, offset, size, headerSize })
      offset += size
    }

    const moovTop = topLevel.find((box) => box.type === 'moov')
    if (!moovTop) return { patched: false, durationMs: 0 }
    const moov = await readRange(handle, moovTop.offset, moovTop.size)
    const moovBox: Box = { type: 'moov', offset: 0, size: moov.length, headerSize: 8 }
    const mvhdBox = childBox(moov, moovBox, 'mvhd')
    const trakBox = childBox(moov, moovBox, 'trak')
    if (!mvhdBox || !trakBox) return { patched: false, durationMs: 0 }
    const tkhdBox = childBox(moov, trakBox, 'tkhd')
    const mdiaBox = childBox(moov, trakBox, 'mdia')
    const mdhdBox = mdiaBox ? childBox(moov, mdiaBox, 'mdhd') : undefined
    if (!tkhdBox || !mdhdBox) return { patched: false, durationMs: 0 }

    const mvhd = readMvhd(moov, mvhdBox)
    const tkhd = readTkhd(moov, tkhdBox)
    const mdhd = readMdhd(moov, mdhdBox)
    if (!mvhd.timescale || !mdhd.timescale) return { patched: false, durationMs: 0 }

    let mediaEnd = 0
    for (const moofTop of topLevel.filter((box) => box.type === 'moof')) {
      const moof = await readRange(handle, moofTop.offset, moofTop.size)
      const moofBox: Box = { type: 'moof', offset: 0, size: moof.length, headerSize: 8 }
      for (const traf of readBoxes(moof, moofBox.headerSize, moof.length).filter(
        (box) => box.type === 'traf'
      )) {
        const tfhd = childBox(moof, traf, 'tfhd')
        const tfdt = childBox(moof, traf, 'tfdt')
        if (!tfhd || !tfdt) continue
        const { defaultDuration } = tfhdDefaults(moof, tfhd)
        let end = tfdtValue(moof, tfdt)
        for (const trun of readBoxes(moof, traf.offset + traf.headerSize, traf.offset + traf.size).filter(
          (box) => box.type === 'trun'
        )) {
          end += trunDuration(moof, trun, defaultDuration)
        }
        mediaEnd = Math.max(mediaEnd, end)
      }
    }
    if (mediaEnd <= 0) return { patched: false, durationMs: 0 }

    const movieDuration = Math.round((mediaEnd * mvhd.timescale) / mdhd.timescale)
    if (movieDuration <= 0) return { patched: false, durationMs: 0 }

    writeDuration(moov, mvhd, movieDuration)
    writeDuration(moov, tkhd, movieDuration)
    writeDuration(moov, mdhd, mediaEnd)
    await handle.write(moov, 0, moov.length, moovTop.offset)

    return { patched: true, durationMs: Math.round((mediaEnd / mdhd.timescale) * 1000) }
  } finally {
    await handle.close()
  }
}
