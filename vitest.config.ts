import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  }
})
