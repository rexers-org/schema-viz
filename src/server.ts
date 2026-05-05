import { createReadStream, existsSync, statSync } from "fs"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import path from "path"

import type { SchemaSource } from "./schema-source"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

function send_json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" })
  res.end(JSON.stringify(data))
}

function serve_file(res: ServerResponse, file_path: string) {
  const ext = path.extname(file_path)
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream")
  createReadStream(file_path).pipe(res)
}

export function start_server(source: SchemaSource, port: number, public_dir: string) {
  const sse_clients = new Set<ServerResponse>()
  const notify_clients = () => {
    for (const client of sse_clients) client.write("data: reload\n\n")
  }

  source.watch(notify_clients)

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`)

    res.setHeader("Access-Control-Allow-Origin", "*")

    if (url.pathname === "/api/schema") {
      void source.load().then(
        (data) => send_json(res, 200, data),
        (e: unknown) => send_json(res, 500, { error: String(e) }),
      )
      return
    }

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

    let file_path = path.join(public_dir, url.pathname === "/" ? "index.html" : url.pathname)
    if (!existsSync(file_path) || statSync(file_path).isDirectory()) {
      file_path = path.join(public_dir, "index.html")
    }
    serve_file(res, file_path)
  })

  server.listen(port)
  return server
}
