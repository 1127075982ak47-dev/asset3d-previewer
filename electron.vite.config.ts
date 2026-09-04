import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // 单独打出来给验收脚本复用，避免脚本里再抄一份会漂移的副本
          pathPolicy: resolve(__dirname, 'src/main/pathPolicy.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          // 主界面
          index: resolve(__dirname, 'src/renderer/index.html'),
          // 隐藏的离屏渲染 worker 窗口
          worker: resolve(__dirname, 'src/renderer/worker.html')
        }
      }
    },
    plugins: [react()]
  }
})
