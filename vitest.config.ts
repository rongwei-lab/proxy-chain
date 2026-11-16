import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 测试配置复用 Vite 的插件和 base 设置，避免测试环境与实际构建环境漂移。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx,mjs}'],
    },
  }),
)
