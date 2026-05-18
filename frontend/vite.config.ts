import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 1420,
    strictPort: true, // 포트 충돌 시 즉시 실패 (Tauri devUrl과 일치해야 함)
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // highlight.js 포함 시 번들이 커지지만 Tauri 데스크탑 앱이므로 무방하다.
    chunkSizeWarningLimit: 1500,
  },
});
