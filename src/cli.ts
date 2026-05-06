#!/usr/bin/env node
import { existsSync } from "fs"
import path from "path"

import {
  builtin_test_fixtures_project_path,
  effective_parser_for_builtin_test,
  is_builtin_test_path_arg,
} from "./test/fixtures"
import { detect_db_dialect, redact_database_url } from "./db/introspect"
import {
  normalize_parser_id,
  resolve_database_context,
  resolve_schema_context,
  type ResolveErr,
  type ResolveOk,
} from "./schema-resolve"
import { create_schema_source } from "./schema-source"
import { start_server } from "./server"

const argv = process.argv.slice(2)

let schema_path_raw: string | undefined
let database_url_flag: string | undefined
let auto_open = false
let share_mode = false
let port = 7337
let parser_raw: string | undefined

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--autoopen" || a === "--auto-open") {
    auto_open = true
    continue
  }
  if (a === "--share") {
    share_mode = true
    continue
  }
  if (a === "--url") {
    database_url_flag = argv[++i]
    if (database_url_flag === undefined) {
      console.error("\n  --url requires a connection string\n")
      process.exit(1)
    }
    continue
  }
  if (a.startsWith("--url=")) {
    database_url_flag = a.slice("--url=".length)
    if (!database_url_flag) {
      console.error("\n  --url= requires a non-empty value\n")
      process.exit(1)
    }
    continue
  }
  if (a === "--parser") {
    parser_raw = argv[++i]
    if (!parser_raw) {
      console.error("\n  --parser requires prisma | laravel | json\n")
      process.exit(1)
    }
    continue
  }
  if (a.startsWith("--parser=")) {
    parser_raw = a.slice("--parser=".length)
    continue
  }
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10) || 7337
    continue
  }
  if (a.startsWith("--")) {
    console.error(`\n  Unknown flag: ${a}`)
    schema_path_raw = undefined
    break
  }
  if (schema_path_raw !== undefined) {
    console.error("\n  Only one path argument is allowed.\n")
    process.exit(1)
  }
  schema_path_raw = a
}

const parser_filter = normalize_parser_id(parser_raw)
if (parser_raw !== undefined && parser_filter === undefined) {
  console.error(`\n  Invalid --parser value: "${parser_raw}". Use prisma, laravel, or json.\n`)
  process.exit(1)
}

const database_url_from_positional =
  schema_path_raw && detect_db_dialect(schema_path_raw.trim()) ? schema_path_raw.trim() : undefined
const effective_database_url = database_url_flag?.trim() || database_url_from_positional
const file_path_arg =
  database_url_from_positional !== undefined && schema_path_raw !== undefined ? undefined : schema_path_raw

if (effective_database_url && parser_filter) {
  console.error("\n  --parser applies to file-based schemas only; omit it when using a database URL.\n")
  process.exit(1)
}

if (database_url_flag && file_path_arg) {
  console.error("\n  Pass either --url or a filesystem path, not both.\n")
  process.exit(1)
}

if (!effective_database_url && !file_path_arg) {
  console.error("")
  console.error("  Usage: schema-viz <path> [options]")
  console.error("     or: schema-viz --url <connection-string> [options]")
  console.error("")
  console.error("  Options:")
  console.error("    --url <connection-string>      PostgreSQL or MySQL URL (alternative to <path>)")
  console.error("    --parser prisma|laravel|json   Only for file-based schemas")
  console.error("    --autoopen                    Open browser (default: do not open)")
  console.error("    --share                       Save layout to .schema-viz.json in the project (shareable)")
  console.error("    --port=7337")
  console.error("")
  console.error("  <path> may be a project directory, schema file, or DB URL starting with")
  console.error('  postgresql:// / postgres:// / mysql://. Use test for built-in fixtures.')
  console.error("")
  process.exit(1)
}

let resolved: ResolveOk | ResolveErr | undefined =
  effective_database_url !== undefined ? resolve_database_context(effective_database_url) : undefined

console.log("")
console.log("  Schema Viz")

if (!resolved) {
  const use_builtin_test = file_path_arg !== undefined && is_builtin_test_path_arg(file_path_arg)
  const builtin_parser = effective_parser_for_builtin_test(parser_filter)
  const schema_path =
    file_path_arg !== undefined && use_builtin_test
      ? builtin_test_fixtures_project_path(builtin_parser)
      : path.resolve(file_path_arg!)

  if (!existsSync(schema_path)) {
    console.error(`\n  Not found: ${schema_path}\n`)
    process.exit(1)
  }

  resolved = resolve_schema_context({ input_path: schema_path, parser_filter })

  if (!resolved.ok) {
    console.error("")
    console.error(`  ${resolved.message}`)
    console.error("")
    process.exit(1)
  }

  console.log(`  Path   : ${schema_path}`)
  if (use_builtin_test) console.log(`  Fixture: builtin test-fixtures (${builtin_parser})`)
  if (parser_filter) console.log(`  Filter : ${parser_filter}`)
  console.log(`  Parser : ${resolved.parser.name}`)
  console.log(`  Mode   : ${resolved.discovery_mode === "single_file" ? "single file" : "recursive discover"}`)
  console.log(`  Root   : ${resolved.project_root}`)
} else {
  if (!resolved.ok) {
    console.error("")
    console.error(`  ${resolved.message}`)
    console.error("")
    process.exit(1)
  }

  console.log(`  Parser : live ${resolved.dialect === "postgresql" ? "PostgreSQL" : "MySQL"} introspection`)
  console.log(`  Mode   : database URL (refresh browser to re-fetch)`)
  console.log(`  DB URL : ${redact_database_url(resolved.database_url)}`)
}

const public_dir = path.join(__dirname, "..", "dist", "public")
const source = create_schema_source(resolved)
const project_root = resolved.source === "files" ? resolved.project_root : process.cwd()
const source_key = resolved.source === "files" ? resolved.project_root : resolved.database_url

const share_file_path = path.join(project_root, ".schema-viz.json")
const share_mode_auto = !share_mode && existsSync(share_file_path)
const effective_share_mode = share_mode || share_mode_auto

start_server(source, port, public_dir, { share_mode: effective_share_mode, project_root, source_key })

console.log(`  URL    : http://localhost:${port}`)
const layout_label = effective_share_mode
  ? `${share_file_path} (${share_mode_auto ? "auto-detected" : "--share"})`
  : "~/.schema-viz/ (cache)"
console.log(`  Layout : ${layout_label}`)
if (resolved.source === "files") {
  console.log(`  Files  : ${resolved.discovered_files.length} (initial)`)
  console.log(`  Reload : parses again on refresh (project mode re-scans subtree)`)
} else {
  console.log(`  Reload : open / refresh to introspect the database again`)
}
console.log("")

if (auto_open) {
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
