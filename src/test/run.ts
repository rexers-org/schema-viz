/**
 * Validates Prisma / Laravel / JSON fixtures parse without error.
 * Invoked via `npm run test-fixtures`.
 */
import path from "path"

import type { ResolveOkFiles } from "@/schema-resolve"
import { resolve_schema_context } from "@/schema-resolve"

function collect_paths_for_parse(resolved: ResolveOkFiles): string[] {
  if (resolved.discovery_mode === "single_file") {
    return [...resolved.discovered_files]
  }
  return resolved.parser.discover_files(resolved.project_root)
}

const root = path.join(__dirname, "../..", "test-fixtures")
const parsers = ["prisma", "laravel", "json"] as const

let failed = false
for (const id of parsers) {
  const dir = path.join(root, id)
  const resolved = resolve_schema_context({ input_path: dir, parser_filter: id })
  if (!resolved.ok) {
    console.error(`[test-fixtures] ${id}: ${resolved.message}`)
    failed = true
    continue
  }
  if (resolved.source !== "files") {
    console.error(`[test-fixtures] ${id}: unexpected resolve mode`)
    failed = true
    continue
  }
  try {
    const data = resolved.parser.parse_files(collect_paths_for_parse(resolved), resolved.project_root)
    if (data.models.length < 2) {
      console.error(`[test-fixtures] ${id}: expected at least 2 models, got ${data.models.length}`)
      failed = true
      continue
    }
    console.log(`[test-fixtures] ok ${id}: ${data.models.length} models, ${data.relations.length} relations`)
  } catch (e) {
    console.error(`[test-fixtures] ${id}: parse threw ${e}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
