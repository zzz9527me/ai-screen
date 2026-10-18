import fs from 'node:fs'

export interface FileSinkOptions {
  onError?: (error: Error) => void
}

/**
 * Streams MP4 chunks to disk as they arrive. Chunks are appended in order; the
 * file only becomes a complete MP4 after `finalize()` resolves.
 */
export class FileSink {
  readonly path: string
  bytesWritten = 0
  private readonly stream: fs.WriteStream
  private finished = false
  private failure: Error | null = null

  constructor(filePath: string, options: FileSinkOptions = {}) {
    this.path = filePath
    this.stream = fs.createWriteStream(filePath, { flags: 'w' })
    this.stream.on('error', (error: Error) => {
      this.failure = error
      options.onError?.(error)
    })
  }

  write(chunk: Uint8Array): void {
    if (this.finished) throw new Error('写入目标已关闭')
    if (this.failure) throw this.failure
    this.bytesWritten += chunk.byteLength
    this.stream.write(chunk)
  }

  async finalize(): Promise<number> {
    if (this.finished) return this.bytesWritten
    this.finished = true
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject)
      this.stream.end(() => resolve())
    })
    if (this.failure) throw this.failure
    return this.bytesWritten
  }

  destroy(): void {
    if (this.finished) return
    this.finished = true
    this.stream.destroy()
  }
}
