#!/usr/bin/env node
import { existsSync } from "fs"
import path from "path"

import { start_server } from "./server"

const args = process.argv.slice(2)
const schema_arg = args.find((a) => !a.startsWith("--"))
const no_open = args.includes("--no-open")
const port_arg = args.find((a) => a.startsWith("--port="))
const port = port_arg ? parseInt(port_arg.split("=")[1]) : 7337

if (!schema_arg) {
  console.error("")
  console.error("  Usage: schema-viz <path> [--port=7337] [--no-open]")
  console.error("")
  console.error("  Examples:")
  console.error("    schema-viz ./prisma/schema")
  console.error("    schema-viz ./prisma/schema.prisma --port=8080")
  console.error("")
  process.exit(1)
}

const schema_path = path.resolve(schema_arg)

if (!existsSync(schema_path)) {
  console.error(`\n  Not found: ${schema_path}\n`)
  process.exit(1)
}

console.log("")
console.log("  Schema Viz")
console.log(`  Path   : ${schema_path}`)

// __dirname is src/ when run via tsx, dist/ when compiled — both resolve to dist/public
const public_dir = path.join(__dirname, "..", "dist", "public")
start_server(schema_path, port, public_dir)

console.log(`  URL    : http://localhost:${port}`)
console.log("")

if (!no_open) {
  // Give the server a moment to start before opening the browser
  setTimeout(() => {
    const url = `http://localhost:${port}`
    const cmd =
      process.platform === "darwin"
        ? `open "${url}"`
        : process.platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("child_process").exec(cmd)
  }, 500)
}
