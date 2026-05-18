import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 1420,
    strictPort: true, // 포트 충돌 시 즉시 실패 (Tauri devUrl과 일치해야 함)
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
