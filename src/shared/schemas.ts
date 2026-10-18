import { z } from 'zod'

export const captureModeSchema = z.enum(['fullscreen', 'region', 'window'])

export const regionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(16),
  height: z.number().int().min(16)
})

export const settingsSchema = z.object({
  version: z.literal(1),
  storageDirectory: z.string().min(1),
  region: regionSchema,
  lastMode: captureModeSchema,
  updatedAt: z.string().min(1)
})

export const settingsInputSchema = z.object({
  storageDirectory: z.string().min(1).optional(),
  region: regionSchema.optional(),
  lastMode: captureModeSchema.optional()
})

export const startCaptureRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fullscreen') }),
  z.object({ mode: z.literal('region'), region: regionSchema }),
  z.object({
    mode: z.literal('window'),
    windowSourceId: z.string().min(1),
    windowName: z.string()
  })
])

export const captureReadySchema = z.object({
  sessionId: z.string().min(1),
  mimeType: z.string()
})

export const captureChunkSchema = z.object({
  sessionId: z.string().min(1),
  data: z.instanceof(ArrayBuffer)
})

export const captureFinishedSchema = z.object({
  sessionId: z.string().min(1),
  ok: z.boolean(),
  outputPath: z.string().optional(),
  error: z.string().optional()
})

export const regionSelectedSchema = z.object({
  rect: regionSchema
})
