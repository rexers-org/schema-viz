import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  target: "node18",
  clean: false, // don't wipe dist/public built by vite
  external: ["pg", "mysql2"],
  esbuildOptions(options) {
    options.alias = { "@": "./src" }
  },
})
