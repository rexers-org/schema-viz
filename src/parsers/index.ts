import type { SchemaData } from "../types"
import { jsonParser } from "./json"
import { prismaParser } from "./prisma"

export interface Parser {
  name: string
  /** Return true if this parser can handle the given path. */
  detect(inputPath: string): boolean
  /** Parse the schema at the given path and return normalized SchemaData. */
  parse(inputPath: string): SchemaData
}

/*
 * Register parsers here in priority order. The first parser whose detect()
 * returns true will be used. Adding a new ORM/DB format means creating a new
 * file (e.g. parsers/laravel.ts) and appending it to this list.
 */
const PARSERS: Parser[] = [
  prismaParser,
  jsonParser,
  // laravelParser,
  // drizzleParser,
]

export function get_parser(input_path: string): Parser | undefined {
  return PARSERS.find((p) => p.detect(input_path))
}
