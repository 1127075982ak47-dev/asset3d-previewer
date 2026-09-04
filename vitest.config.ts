import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // 纯逻辑模块不依赖 electron；少数 import 了 electron 的用桩替换
      electron: resolve(__dirname, 'tests/stubs/electron.ts')
    }
  }
})
