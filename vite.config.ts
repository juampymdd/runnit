import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and no clobbering of its env vars.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Empty inline PostCSS config: stop Vite from walking up to a stray
  // postcss.config in a parent directory (we ship plain CSS, no PostCSS).
  css: { postcss: {} },
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the Rust/sidecar sources from Vite.
      ignored: ["**/src-tauri/**", "**/sidecar/**"],
    },
  },
  // Produce a build compatible with the Tauri webview (modern Chromium/WebKit).
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
