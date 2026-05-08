import path from "path"
import { readFileSync } from "fs"

import { collect_files_recursive } from "@/lib/discovery"

import type { Field, Model, Relation, SchemaData } from "@/types"
import type { Parser, ParserId } from "./index"

const TABLE_FNS = ["pgTable", "mysqlTable", "sqliteTable"]
const TABLE_FN_PATTERN = TABLE_FNS.join("|")
const DRIZZLE_IMPORT_RE = /from\s+['"]drizzle-orm/
const TABLE_DEF_RE = new RegExp(`(?:${TABLE_FN_PATTERN})\\s*\\(`)

const TYPE_MAP: Record<string, string> = {
  serial: "serial",
  bigserial: "bigserial",
  integer: "int",
  int: "int",
  int2: "int",
  int4: "int",
  int8: "bigint",
  smallint: "int",
  bigint: "bigint",
  varchar: "varchar",
  char: "varchar",
  text: "text",
  citext: "text",
  boolean: "boolean",
  bool: "boolean",
  timestamp: "timestamp",
  timestamptz: "timestamp",
  date: "date",
  time: "time",
  json: "json",
  jsonb: "json",
  decimal: "decimal",
  numeric: "decimal",
  real: "decimal",
  doublePrecision: "decimal",
  uuid: "uuid",
}

function skip_string(s: string, i: number): number {
  const quote = s[i]
  if (quote !== "'" && quote !== '"' && quote !== "`") return i
  let j = i + 1
  while (j < s.length) {
    if (s[j] === "\\" && j + 1 < s.length) {
      j += 2
      continue
    }
    if (s[j] === quote) return j + 1
    j++
  }
  return s.length
}

function extract_brace_body(s: string, from_idx: number): { inner: string; end: number } | undefined {
  let i = from_idx
  while (i < s.length && s[i] !== "{") {
    if (s[i] === "'" || s[i] === '"' || s[i] === "`") {
      i = skip_string(s, i)
      continue
    }
    i++
  }
  if (i >= s.length) return undefined

  let depth = 0
  const open = i
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === "'" || c === '"' || c === "`") {
      j = skip_string(s, j)
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return { inner: s.slice(open + 1, j), end: j + 1 }
    }
    j++
  }
  return undefined
}

function singularize(word: string): string {
  if (word.length <= 1) return word
  if (word.endsWith("ies") && word.length > 3) return word.slice(0, -3) + "y"
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes")) return word.slice(0, -2)
  if (word.endsWith("s") && word.length > 2) return word.slice(0, -1)
  return word
}

function table_name_to_model_name(table_name: string): string {
  const parts = table_name.split("_").filter(Boolean)
  return parts
    .map((part, idx) => {
      const seg = idx === parts.length - 1 ? singularize(part) : part
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
    })
    .join("")
}

function map_column_type(fn_name: string): string {
  return TYPE_MAP[fn_name] ?? fn_name
}

type RawFkRef = {
  from_var: string
  from_field: string
  to_var: string
  to_field: string
}

type TableParsed = {
  var_name: string
  table_name: string
  model_name: string
  group: string
  fields: Field[]
  raw_fk_refs: RawFkRef[]
}

const COLUMN_LINE_RE = /(\w+)\s*:\s*(\w+)\s*\(\s*['"]([^'"]+)['"]/

function parse_table_body(
  body: string,
  var_name: string,
): { fields: Field[]; raw_fk_refs: RawFkRef[] } {
  const fields: Field[] = []
  const raw_fk_refs: RawFkRef[] = []

  const lines = body.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//")) continue

    const m = COLUMN_LINE_RE.exec(trimmed)
    if (!m) continue

    const prop_name = m[1]
    const type_fn = m[2]
    const rest = trimmed.slice(m.index + m[0].length)

    const is_pk = /\.primaryKey\s*\(/.test(rest)
    const is_unique = /\.unique\s*\(/.test(rest)
    const is_not_null = /\.notNull\s*\(/.test(rest)

    let is_fk = false
    const ref_match = /\.references\s*\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/.exec(rest)
    if (ref_match) {
      is_fk = true
      raw_fk_refs.push({
        from_var: var_name,
        from_field: prop_name,
        to_var: ref_match[1],
        to_field: ref_match[2],
      })
    }

    fields.push({
      name: prop_name,
      type: map_column_type(type_fn),
      isPK: is_pk,
      isFK: is_fk,
      isUnique: is_unique,
      isOptional: !is_not_null && !is_pk,
    })
  }

  return { fields, raw_fk_refs }
}

const TABLE_DECL_RE = new RegExp(
  `(?:export\\s+)?const\\s+(\\w+)\\s*=\\s*(?:${TABLE_FN_PATTERN})\\s*\\(\\s*['"]([^'"]+)['"]`,
  "g",
)

function parse_file_tables(content: string, group: string): TableParsed[] {
  const results: TableParsed[] = []

  TABLE_DECL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TABLE_DECL_RE.exec(content)) !== null) {
    const var_name = m[1]
    const table_name = m[2]
    const model_name = table_name_to_model_name(table_name)

    const after_table_name = content.indexOf(",", m.index + m[0].length)
    if (after_table_name === -1) continue

    const body_result = extract_brace_body(content, after_table_name + 1)
    if (!body_result) continue

    const { fields, raw_fk_refs } = parse_table_body(body_result.inner, var_name)

    results.push({ var_name, table_name, model_name, group, fields, raw_fk_refs })
  }

  return results
}

const RELATIONS_DECL_RE = /(?:export\s+)?const\s+\w+\s*=\s*relations\s*\(\s*(\w+)\s*,/g
const ONE_CALL_RE = /\bone\s*\(\s*(\w+)\s*,\s*\{[^}]*fields\s*:\s*\[([^\]]+)\][^}]*references\s*:\s*\[([^\]]+)\]/g

function parse_file_relations(content: string): RawFkRef[] {
  const results: RawFkRef[] = []

  RELATIONS_DECL_RE.lastIndex = 0
  let decl_m: RegExpExecArray | null
  while ((decl_m = RELATIONS_DECL_RE.exec(content)) !== null) {
    const from_var = decl_m[1]

    const arrow_idx = content.indexOf("=>", decl_m.index + decl_m[0].length)
    if (arrow_idx === -1) continue

    const body_result = extract_brace_body(content, arrow_idx + 2)
    if (!body_result) continue

    const rel_body = body_result.inner
    ONE_CALL_RE.lastIndex = 0
    let one_m: RegExpExecArray | null
    while ((one_m = ONE_CALL_RE.exec(rel_body)) !== null) {
      const to_var = one_m[1]
      const fields_raw = one_m[2].split(",").map((s) => {
        const dot = s.trim().lastIndexOf(".")
        return dot >= 0 ? s.trim().slice(dot + 1) : s.trim()
      })
      const refs_raw = one_m[3].split(",").map((s) => {
        const dot = s.trim().lastIndexOf(".")
        return dot >= 0 ? s.trim().slice(dot + 1) : s.trim()
      })

      for (let i = 0; i < fields_raw.length; i++) {
        results.push({
          from_var,
          from_field: fields_raw[i],
          to_var,
          to_field: refs_raw[i] ?? refs_raw[0],
        })
      }
    }
  }

  return results
}

function is_drizzle_file(content: string): boolean {
  return DRIZZLE_IMPORT_RE.test(content) && TABLE_DEF_RE.test(content)
}

function dedupe_relations(relations: Relation[]): Relation[] {
  const seen = new Set<string>()
  const out: Relation[] = []
  for (const r of relations) {
    const key = `${r.fromModel}.${r.fromField}->${r.toModel}.${r.toField}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

function parse_files(abs_paths: string[], project_root: string): SchemaData {
  const all_tables: TableParsed[] = []
  const all_raw_relations: RawFkRef[] = []

  for (const abs_path of abs_paths) {
    let content: string
    try {
      content = readFileSync(abs_path, "utf-8")
    } catch {
      continue
    }
    const group = path.relative(project_root, abs_path).replace(/\\/g, "/") || path.basename(abs_path)
    all_tables.push(...parse_file_tables(content, group))
    all_raw_relations.push(...parse_file_relations(content))
  }

  const var_to_model = new Map<string, { name: string; table_name: string }>()
  for (const t of all_tables) {
    var_to_model.set(t.var_name, { name: t.model_name, table_name: t.table_name })
  }

  const relations: Relation[] = []

  const collect_resolved = (refs: RawFkRef[]) => {
    for (const ref of refs) {
      const from_model = var_to_model.get(ref.from_var)
      const to_model = var_to_model.get(ref.to_var)
      if (!from_model || !to_model) continue
      relations.push({
        fromModel: from_model.name,
        fromField: ref.from_field,
        toModel: to_model.name,
        toField: ref.to_field,
      })
    }
  }

  for (const t of all_tables) {
    collect_resolved(t.raw_fk_refs)
  }
  collect_resolved(all_raw_relations)

  const models: Model[] = all_tables.map((t) => ({
    name: t.model_name,
    tableName: t.table_name,
    group: t.group,
    fields: t.fields,
  }))

  const models_by_group: Record<string, Model[]> = {}
  for (const model of models) {
    models_by_group[model.group] ??= []
    models_by_group[model.group].push(model)
  }

  return {
    models,
    relations: dedupe_relations(relations),
    modelsByGroup: models_by_group,
    parserName: "drizzle",
  }
}

function discover_files(project_root: string): string[] {
  const candidates = collect_files_recursive({
    project_root,
    basename_match: (name) => {
      if (!name.endsWith(".ts")) return false
      if (name.endsWith(".test.ts") || name.endsWith(".spec.ts") || name.endsWith(".d.ts")) return false
      return true
    },
  })

  return candidates.filter((abs_path) => {
    try {
      const content = readFileSync(abs_path, "utf-8")
      return DRIZZLE_IMPORT_RE.test(content)
    } catch {
      return false
    }
  })
}

function matches_single_file(abs_path: string): boolean {
  const base = path.basename(abs_path)
  if (!base.endsWith(".ts")) return false
  if (base.endsWith(".test.ts") || base.endsWith(".spec.ts") || base.endsWith(".d.ts")) return false
  return true
}

export const drizzleParser: Parser = {
  id: "drizzle",
  name: "Drizzle ORM",
  file_requirement_hint: "Expected a TypeScript file with drizzle-orm imports and pgTable/mysqlTable/sqliteTable definitions",
  discover_files,
  matches_single_file,
  parse_files,
}
