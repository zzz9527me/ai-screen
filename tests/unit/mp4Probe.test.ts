import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkMp4File } from '../../src/main/services/mp4Probe'

const dirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mp4-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('checkMp4File', () => {
  it('accepts a file with an ftyp header and plausible size', async () => {
    const file = path.join(makeDir(), 'valid.mp4')
    const buffer = Buffer.alloc(2048)
    buffer.write('ftyp', 4, 'ascii')
    fs.writeFileSync(file, buffer)
    expect(await checkMp4File(file)).toEqual({ ok: true, size: 2048 })
  })

  it('rejects files that are too small', async () => {
    const file = path.join(makeDir(), 'small.mp4')
    const buffer = Buffer.alloc(100)
    buffer.write('ftyp', 4, 'ascii')
    fs.writeFileSync(file, buffer)
    const result = await checkMp4File(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('过小')
  })

  it('rejects files without an ftyp box', async () => {
    const file = path.join(makeDir(), 'no-ftyp.mp4')
    fs.writeFileSync(file, Buffer.alloc(2048, 1))
    const result = await checkMp4File(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ftyp')
  })

  it('rejects missing files', async () => {
    const result = await checkMp4File(path.join(makeDir(), 'missing.mp4'))
    expect(result.ok).toBe(false)
  })
})
