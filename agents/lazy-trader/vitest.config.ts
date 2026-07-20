import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
  ssr: {
    noExternal: ['@yeetful/agent-kit'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 20_000,
    server: {
      deps: {
        inline: ['@yeetful/agent-kit', 'yeetful'],
      },
    },
  },
})
