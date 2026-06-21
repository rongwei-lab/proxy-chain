import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 使用相对资源路径，保证同一份 dist 同时适配 GitHub Pages 的 /proxy-chain/
  // 子路径部署，以及 Cloudflare Worker 的根路径静态资源托管。
  base: './',
  plugins: [react()],
})
