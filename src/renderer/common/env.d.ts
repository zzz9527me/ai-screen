import type { DshApi } from '@shared/types'

declare global {
  interface Window {
    dsh: DshApi
  }
}

export {}
