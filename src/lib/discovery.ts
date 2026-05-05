import { readdirSync, type Dirent } from "fs"
import path from "path"

/** Directory names skipped when walking a project tree. */
export const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
  ".cache",
  ".output",
])

/** Chokidar ignore patterns aligned with traversal skips. */
export const CHOKIDAR_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
]

export function collect_files_recursive(params: {
  project_root: string
  basename_match: (name: string) => boolean
}): string[] {
  const { project_root, basename_match } = params
  const out: string[] = []

  function walk(dir_abs: string) {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir_abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir_abs, e.name)
      if (e.isDirectory()) {
        if (IGNORE_DIR_NAMES.has(e.name)) continue
        walk(full)
        continue
      }
      if (e.isFile() && basename_match(e.name)) out.push(full)
    }
  }

  walk(project_root)
  out.sort((a, b) => a.localeCompare(b))
  return out
}
