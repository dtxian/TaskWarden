import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri CLI 在 beforeDevCommand/beforeBuildCommand 子进程注入 TAURI_ENV_PLATFORM；
// 桌面构建产物嵌入 tauri://localhost 根路径 → base 必须是 "/"；
// GitHub Pages 走仓库子路径部署 → "/TaskWarden/"。
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  // GitHub Pages 子路径部署（仓库名 TaskWarden）；Tauri 内为资源根
  base: isTauri ? "/" : "/TaskWarden/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 1400,
    strictPort: true,
    hmr: {
      port: 1400,
    },
    // 忽略非 Web 资源避免 watcher 崩溃
    watch: {
      ignored: ["**/*.rs", "**/*.toml", "**/target/**", "**/.git/**", "**/src-tauri/**"],
    },
  },
});
