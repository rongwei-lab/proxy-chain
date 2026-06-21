import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 测试配置复用 Vite 的插件和 base 设置，避免测试环境与实际构建环境漂移。
// 当前项目尚未包含测试用例，package 脚本使用 --passWithNoTests 作为脚手架阶段的过渡。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }),
)
