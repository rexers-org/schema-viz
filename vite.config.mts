import { resolve } from "path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "ui",
  resolve: {
    alias: {
      "@": resolve(__dirname, "ui/src"),
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    // During UI dev, proxy API calls to the running CLI server
    proxy: {
      "/api": "http://localhost:7337",
    },
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
})
