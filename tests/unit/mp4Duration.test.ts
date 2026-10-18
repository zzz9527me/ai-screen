import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchMp4Duration } from '../../src/main/services/mp4Duration'

const dirs: string[] = []

function tempFile(buffer: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mp4-'))
  dirs.push(dir)
  const file = path.join(dir, 'sample.mp4')
  fs.writeFileSync(file, buffer)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function box(type: string, payload: Buffer): Buffer {
  const buffer = Buffer.alloc(8 + payload.length)
  buffer.writeUInt32BE(buffer.length, 0)
  buffer.write(type, 4, 'ascii')
  payload.copy(buffer, 8)
  return buffer
}

function fullBox(type: string, version: number, flags: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header[0] = version
  header.writeUIntBE(flags, 1, 3)
  return box(type, Buffer.concat([header, payload]))
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(value), 0)
  return buffer
}

function fragmentedFixture(): Buffer {
  const mvhdPayload = Buffer.alloc(108)
  mvhdPayload.writeUInt32BE(1000, 16)
  mvhdPayload.writeBigUInt64BE(0n, 20)
  const mvhd = fullBox('mvhd', 1, 0, mvhdPayload)

  const tkhdPayload = Buffer.alloc(92)
  tkhdPayload.writeUInt32BE(1, 16)
  tkhdPayload.writeBigUInt64BE(0n, 24)
  const tkhd = fullBox('tkhd', 1, 0, tkhdPayload)

  const mdhdPayload = Buffer.alloc(32)
  mdhdPayload.writeUInt32BE(30000, 16)
  mdhdPayload.writeBigUInt64BE(0n, 20)
  const mdhd = fullBox('mdhd', 1, 0, mdhdPayload)

  const trak = box('trak', Buffer.concat([tkhd, box('mdia', mdhd)]))
  const moov = box('moov', Buffer.concat([mvhd, trak]))

  const tfhdPayload = Buffer.alloc(8)
  tfhdPayload.writeUInt32BE(1, 0)
  tfhdPayload.writeUInt32BE(1001, 4)
  const tfhd = fullBox('tfhd', 0, 0x020008, tfhdPayload)
  const tfdt = fullBox('tfdt', 1, 0, u64(0))

  const trunPayload = Buffer.alloc(4 + 4 + 4 + 30 * 8)
  trunPayload.writeUInt32BE(30, 0)
  trunPayload.writeInt32BE(0, 4)
  trunPayload.writeUInt32BE(0, 8)
  for (let index = 0; index < 30; index += 1) {
    const cursor = 12 + index * 8
    trunPayload.writeUInt32BE(1001, cursor)
    trunPayload.writeUInt32BE(100, cursor + 4)
  }
  const trun = fullBox('trun', 0, 0x305, trunPayload)
  const moof = box('moof', box('traf', Buffer.concat([tfhd, tfdt, trun])))

  const ftyp = box('ftyp', Buffer.from('isomiso2avc1mp41', 'ascii'))
  const mdat = box('mdat', Buffer.alloc(3000))
  return Buffer.concat([ftyp, moov, moof, mdat])
}

describe('patchMp4Duration', () => {
  it('computes duration from fragments and writes it to mvhd/tkhd/mdhd', async () => {
    const file = tempFile(fragmentedFixture())
    const sizeBefore = fs.statSync(file).size
    const result = await patchMp4Duration(file)
    expect(result).toEqual({ patched: true, durationMs: 1001 })
    expect(fs.statSync(file).size).toBe(sizeBefore)

    const buffer = fs.readFileSync(file)
    const mvhd = buffer.indexOf(Buffer.from('mvhd'))
    const tkhd = buffer.indexOf(Buffer.from('tkhd'))
    const mdhd = buffer.indexOf(Buffer.from('mdhd'))
    expect(Number(buffer.readBigUInt64BE(mvhd + 28))).toBe(1001)
    expect(Number(buffer.readBigUInt64BE(tkhd + 32))).toBe(1001)
    expect(Number(buffer.readBigUInt64BE(mdhd + 28))).toBe(30030)
  })

  it('reports unpatched for a file without moov', async () => {
    const file = tempFile(Buffer.from('not an mp4'))
    await expect(patchMp4Duration(file)).resolves.toEqual({ patched: false, durationMs: 0 })
  })
})
