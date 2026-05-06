import { createReadStream, existsSync, statSync } from "fs"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import path from "path"

import { clear_layout, ensure_cache_dir, load_layout, save_layout, type LayoutFile } from "./lib/layout-store"
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

function read_body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

type ServerOptions = {
  share_mode: boolean
  project_root: string
  source_key: string
}

export function start_server(source: SchemaSource, port: number, public_dir: string, opts: ServerOptions) {
  const { share_mode, project_root, source_key } = opts
  if (!share_mode) ensure_cache_dir()
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

    if (url.pathname === "/api/config") {
      send_json(res, 200, { shareMode: share_mode })
      return
    }

    if (url.pathname === "/api/layout") {
      if (req.method === "GET") {
        const data = load_layout(share_mode, project_root, source_key)
        send_json(res, 200, data ?? null)
        return
      }

      if (req.method === "POST") {
        void read_body(req).then(
          (body) => {
            try {
              const data = JSON.parse(body) as LayoutFile
              save_layout(share_mode, project_root, source_key, data)
              send_json(res, 200, { ok: true })
            } catch {
              send_json(res, 400, { error: "invalid JSON" })
            }
          },
          () => send_json(res, 400, { error: "read error" }),
        )
        return
      }

      if (req.method === "DELETE") {
        clear_layout(share_mode, project_root, source_key)
        send_json(res, 200, { ok: true })
        return
      }
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
