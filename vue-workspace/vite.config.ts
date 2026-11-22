import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
const proxy = {
  "/api/workspace": { target: "http://127.0.0.1:3100", changeOrigin: false },
};
export default defineConfig({
  base: "./",
  plugins: [vue()],
  css: { postcss: { plugins: [] } },
  server: { host: "localhost", port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
