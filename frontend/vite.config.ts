import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const versionFile = [
  path.resolve(__dirname, "../VERSION"),
  path.resolve(__dirname, "VERSION"),
].find((f) => fs.existsSync(f));
const version = versionFile
  ? fs.readFileSync(versionFile, "utf-8").trim()
  : "0.0.0-dev";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
