import path from "path"

import chokidar from "chokidar"

import { CHOKIDAR_IGNORE_GLOBS } from "./lib/discovery"
import {
  create_mysql_pool,
  create_postgresql_pool,
  introspect_live_database,
} from "./db/introspect"
import type { Parser } from "./parsers/index"
import type { ResolveOk, ResolveOkDatabase, ResolveOkFiles } from "./schema-resolve"
import type { SchemaData } from "./types"

export interface SchemaSource {
  load(): Promise<SchemaData>
  watch(on_change: () => void): void
}

function watch_glob_for(parser: Parser, project_root: string): string {
  const ext = parser.id === "prisma" ? "prisma" : parser.id === "laravel" ? "php" : "json"
  return path.join(project_root, `**/*.${ext}`)
}

function create_file_source(resolved: ResolveOkFiles): SchemaSource {
  function collect_paths(): string[] {
    if (resolved.discovery_mode === "single_file") return [...resolved.discovered_files]
    return resolved.parser.discover_files(resolved.project_root)
  }

  return {
    load(): Promise<SchemaData> {
      const paths = collect_paths()
      if (paths.length === 0) {
        return Promise.reject(new Error("No matching schema files under the project path anymore."))
      }
      return Promise.resolve(resolved.parser.parse_files(paths, resolved.project_root))
    },
    watch(on_change: () => void): void {
      const glob = watch_glob_for(resolved.parser, resolved.project_root)
      chokidar
        .watch(glob, { ignoreInitial: true, ignored: CHOKIDAR_IGNORE_GLOBS })
        .on("all", (event, changed_path) => {
          console.log(`  ${event}: ${path.relative(resolved.project_root, changed_path)}`)
          on_change()
        })
    },
  }
}

function create_database_source(resolved: ResolveOkDatabase): SchemaSource {
  const pg_pool = resolved.dialect === "postgresql" ? create_postgresql_pool(resolved.database_url) : undefined
  const mysql_pool = resolved.dialect === "mysql" ? create_mysql_pool(resolved.database_url) : undefined

  return {
    load(): Promise<SchemaData> {
      return introspect_live_database({ dialect: resolved.dialect, pg_pool, mysql_pool })
    },
    watch(): void {},
  }
}

export function create_schema_source(resolved: ResolveOk): SchemaSource {
  if (resolved.source === "database") return create_database_source(resolved)
  return create_file_source(resolved)
}
