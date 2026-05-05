import { createReadStream, existsSync, statSync } from "fs"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import path from "path"

import chokidar from "chokidar"

import { get_parser } from "./parsers/index"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

function send_json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" })
  res.end(JSON.stringify(data))
}

function serve_file(res: ServerResponse, file_path: string) {
  const ext = path.extname(file_path)
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream")
  createReadStream(file_path).pipe(res)
}

export function start_server(schema_path: string, port: number, public_dir: string) {
  const parser = get_parser(schema_path)
  if (!parser) {
    console.error(`\n  No parser found for: ${schema_path}`)
    console.error("  Supported: Prisma (.prisma file or schema/ directory)\n")
    process.exit(1)
  }

  console.log(`  Parser : ${parser.name}`)

  // SSE clients — browser connects here and receives "reload" when files change
  const sse_clients = new Set<ServerResponse>()

  const notify_clients = () => {
    for (const client of sse_clients) client.write("data: reload\n\n")
  }

  // Watch schema path for changes
  const is_dir = statSync(schema_path).isDirectory()
  chokidar
    .watch(is_dir ? path.join(schema_path, "**/*.prisma") : schema_path, { ignoreInitial: true })
    .on("all", (event, file) => {
      console.log(`  ${event}: ${path.relative(schema_path, file)}`)
      notify_clients()
    })


  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`)

    res.setHeader("Access-Control-Allow-Origin", "*")

    // --- API: parse and return schema ---
    if (url.pathname === "/api/schema") {
      try {
        send_json(res, 200, parser.parse(schema_path))
      } catch (e) {
        send_json(res, 500, { error: String(e) })
      }
      return
    }

    // --- API: SSE stream for live reload ---
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })
      res.flushHeaders()
      sse_clients.add(res)
      req.on("close", () => sse_clients.delete(res))
      return
    }

    // --- Static files (pre-built Vite output) ---
    let file_path = path.join(public_dir, url.pathname === "/" ? "index.html" : url.pathname)
    if (!existsSync(file_path) || statSync(file_path).isDirectory()) {
      file_path = path.join(public_dir, "index.html") // SPA fallback
    }
    serve_file(res, file_path)
  })

  server.listen(port)
  return server
}
