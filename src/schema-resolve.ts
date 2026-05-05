import { existsSync, statSync } from "fs"
import path from "path"

import { detect_db_dialect, type DbDialect } from "./db/introspect"
import { PARSERS, PARSERS_BY_ID, type Parser, type ParserId } from "./parsers/index"

export type { DbDialect }

export type ResolveOkFiles = {
  ok: true
  source: "files"
  project_root: string
  parser: Parser
  /**
   * `single_file`: always parse exactly `discovered_files` (narrow CLI file arg).
   * `project_tree`: re-run `parser.discover_files(project_root)` on each parse so new files appear.
   */
  discovery_mode: "single_file" | "project_tree"
  discovered_files: string[]
}

export type ResolveOkDatabase = {
  ok: true
  source: "database"
  dialect: DbDialect
  database_url: string
}

export type ResolveOk = ResolveOkFiles | ResolveOkDatabase

export type ResolveErr = { ok: false; message: string }

export function normalize_parser_id(raw: string | undefined): ParserId | undefined {
  if (!raw) return undefined
  const lowered = raw.trim().toLowerCase()
  return PARSERS.some((p) => p.id === lowered) ? (lowered as ParserId) : undefined
}

function no_matching_file_message(parser_id: ParserId): string {
  switch (parser_id) {
    case "prisma":
      return "No Prisma schema files (*.prisma) found under this path."
    case "laravel":
      return (
        "No Laravel migration files matching YYYY_MM_DD_HHmmss_*.php found under this path."
      )
    case "json":
      return "No JSON files (*.json) found under this path."
    default:
      return "No matching schema files found."
  }
}

function no_schema_any_message(): string {
  return (
    "No schema files found (Prisma *.prisma, Laravel migrations, or JSON). " +
    "Pass a project directory, or use --parser prisma|laravel|json to require a specific format."
  )
}

export function resolve_database_context(database_url_raw: string): ResolveOkDatabase | ResolveErr {
  const database_url = database_url_raw.trim()
  if (!database_url) {
    return { ok: false, message: "Database URL is empty." }
  }
  const dialect = detect_db_dialect(database_url)
  if (!dialect) {
    return {
      ok: false,
      message:
        'Database URL scheme not recognized. Use a connection string starting with postgresql://, postgres://, mysql://, or mysql2://.',
    }
  }
  try {
    // eslint-disable-next-line no-new
    new URL(database_url)
  } catch {
    return { ok: false, message: "Invalid database URL (could not parse as URL)." }
  }
  return { ok: true, source: "database", dialect, database_url }
}

export function resolve_schema_context(params: {
  input_path: string
  parser_filter?: ParserId
}): ResolveOkFiles | ResolveErr {
  const abs = path.resolve(params.input_path)
  if (!existsSync(abs)) {
    return { ok: false, message: `Path does not exist: ${abs}` }
  }

  const st = statSync(abs)
  const is_file = st.isFile()
  const project_root = is_file ? path.dirname(abs) : abs

  const { parser_filter } = params

  if (parser_filter) {
    const parser = PARSERS_BY_ID[parser_filter]
    if (!parser) {
      return {
        ok: false,
        message: `Unknown --parser value. Use one of: ${PARSERS.map((p) => p.id).join(", ")}.`,
      }
    }

    if (is_file) {
      if (!parser.matches_single_file(abs)) {
        return {
          ok: false,
          message: `The file does not match ${parser.name}. ${parser.file_requirement_hint}.`,
        }
      }
      return {
        ok: true,
        source: "files",
        project_root,
        parser,
        discovery_mode: "single_file",
        discovered_files: [abs],
      }
    }

    const discovered_files = parser.discover_files(project_root)
    if (discovered_files.length === 0) {
      return { ok: false, message: no_matching_file_message(parser_filter) }
    }
    return {
      ok: true,
      source: "files",
      project_root,
      parser,
      discovery_mode: "project_tree",
      discovered_files,
    }
  }

  if (is_file) {
    const parser = PARSERS.find((p) => p.matches_single_file(abs))
    if (!parser) {
      return {
        ok: false,
        message:
          "No parser matches this file. Use a .prisma file, a Laravel migration " +
          "(YYYY_MM_DD_HHmmss_*.php), or a .json schema file, or pass --parser.",
      }
    }
    return {
      ok: true,
      source: "files",
      project_root,
      parser,
      discovery_mode: "single_file",
      discovered_files: [abs],
    }
  }

  for (const parser of PARSERS) {
    const discovered_files = parser.discover_files(project_root)
    if (discovered_files.length > 0) {
      return {
        ok: true,
        source: "files",
        project_root,
        parser,
        discovery_mode: "project_tree",
        discovered_files,
      }
    }
  }

  return { ok: false, message: no_schema_any_message() }
}
