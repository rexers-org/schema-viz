import path from "path"

import type { ParserId } from "./parsers/index"

/** Package root (`schema-viz/`), works from `tsx src/*.ts` and compiled `dist/*.js`. */
export function schema_viz_package_root(): string {
  return path.join(__dirname, "..")
}

/** Subtree used when the CLI path is the sentinel `test` (see README). */
export function builtin_test_fixtures_project_path(parser: ParserId): string {
  return path.join(schema_viz_package_root(), "test-fixtures", parser)
}

export function is_builtin_test_path_arg(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const t = raw.trim().toLowerCase()
  return t === "test" || t === "fixtures" || t === "test-fixtures"
}

export function effective_parser_for_builtin_test(parser_filter?: ParserId): ParserId {
  return parser_filter ?? "prisma"
}
