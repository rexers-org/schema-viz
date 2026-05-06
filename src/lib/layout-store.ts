import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import os from "os"
import path from "path"

export type LayoutFile = {
  v: 1
  sigHash: string
  positions: Record<string, { x: number; y: number }>
}

export function sig_hash(schema_signature: string): string {
  return createHash("sha1").update(schema_signature).digest("hex").slice(0, 16)
}

function cache_dir(): string {
  return path.join(os.homedir(), ".schema-viz")
}

function cache_file(source_key: string): string {
  const h = createHash("sha1").update(source_key).digest("hex").slice(0, 16)
  return path.join(cache_dir(), `${h}.json`)
}

function share_file(project_root: string): string {
  return path.join(project_root, ".schema-viz.json")
}

function resolve_file(share_mode: boolean, project_root: string, source_key: string): string {
  return share_mode ? share_file(project_root) : cache_file(source_key)
}

export function load_layout(share_mode: boolean, project_root: string, source_key: string): LayoutFile | null {
  const file = resolve_file(share_mode, project_root, source_key)
  try {
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf8")) as LayoutFile
    if (parsed.v !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function ensure_cache_dir(): void {
  const dir = cache_dir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function save_layout(
  share_mode: boolean,
  project_root: string,
  source_key: string,
  data: LayoutFile,
): void {
  const file = resolve_file(share_mode, project_root, source_key)
  if (!share_mode) ensure_cache_dir()
  const indent = share_mode ? 2 : 0
  writeFileSync(file, JSON.stringify(data, null, indent), "utf8")
}

export function clear_layout(share_mode: boolean, project_root: string, source_key: string): void {
  const file = resolve_file(share_mode, project_root, source_key)
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {}
}
