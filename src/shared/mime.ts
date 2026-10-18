/**
 * Renderer-side MP4 capability probing.
 *
 * `MediaRecorder` only exists in the renderer process, so the ordered candidate
 * list lives in `shared/` and the probe runs inside the capture renderer. The
 * main process hands the list to the renderer via `capture:begin` and expects
 * the chosen mimeType back through `capture:ready`.
 */
export const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42001F',
  'video/mp4;codecs=avc1',
  'video/mp4'
] as const

export function pickSupportedMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of MP4_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime
  }
  return null
}
