import type { SchemaData } from "@/types"
import { drizzleParser } from "./drizzle"
import { jsonParser } from "./json"
import { laravelParser } from "./laravel"
import { prismaParser } from "./prisma"
import { typeormParser } from "./typeorm"

export type ParserId = "prisma" | "laravel" | "json" | "typeorm" | "drizzle"

export interface Parser {
  id: ParserId
  name: string
  /** Shown when a single file path does not match this parser. */
  file_requirement_hint: string
  /** Recursively collect schema files under project root (respects shared ignore dirs). */
  discover_files(project_root: string): string[]
  /** Whether an absolute file path can be parsed by this parser alone. */
  matches_single_file(abs_path: string): boolean
  parse_files(abs_paths: string[], project_root: string): SchemaData
}

/*
 * Register parsers here in priority order when no --parser is passed: the first
 * parser that discovers any file under the project wins.
 * Drizzle is last because its discovery reads all .ts file contents (slower).
 */
export const PARSERS: Parser[] = [prismaParser, laravelParser, typeormParser, jsonParser, drizzleParser]

export const PARSERS_BY_ID: Record<ParserId, Parser> = {
  prisma: prismaParser,
  laravel: laravelParser,
  json: jsonParser,
  typeorm: typeormParser,
  drizzle: drizzleParser,
}
