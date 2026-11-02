import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发服务器默认端口 5173，与 backend 的 DECOCTION_CORS_ORIGINS 默认值一致。
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // 同源访问后端，避免浏览器跨域；需要真实跨域时改用 VITE_API_BASE
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
