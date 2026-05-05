import { readFileSync } from "fs"
import path from "path"

import { collect_files_recursive } from "@/lib/discovery"

import type { Field, Model, Relation, SchemaData } from "@/types"
import type { Parser } from "./index"

type PendingOp = {
  table: string
  body: string
  /** Relative path from project root (POSIX slashes) — used as Model.group / modelsByGroup key. */
  source_migration: string
}

function naive_plural(snake_single: string): string {
  if (
    snake_single.endsWith("s") ||
    snake_single.endsWith("x") ||
    snake_single.endsWith("z") ||
    snake_single.endsWith("ch") ||
    snake_single.endsWith("sh")
  ) {
    return `${snake_single}es`
  }
  if (snake_single.endsWith("y") && snake_single.length > 1) {
    const prev = snake_single[snake_single.length - 2]
    if ("aeiou".includes(prev)) return `${snake_single}s`
    return `${snake_single.slice(0, -1)}ies`
  }
  return `${snake_single}s`
}

function infer_referenced_table_from_column(column_name: string): string | undefined {
  if (!column_name.endsWith("_id")) return undefined
  const base = column_name.slice(0, -3)
  if (!base) return undefined
  return naive_plural(base)
}

function table_name_to_display_model(table_name: string): string {
  return table_name
    .split("_")
    .filter(Boolean)
    .map((segment) => {
      const singular =
        segment.endsWith("ies") && segment.length > 3
          ? `${segment.slice(0, -3)}y`
          : segment.endsWith("es") && segment.length > 2
            ? segment
                .replace(/ies$/, "y")
                .replace(/xes$/, "x")
                .replace(/sses$/, "ss")
                .replace(/shes$/, "sh")
                .replace(/ches$/, "ch")
                .replace(/oes$/, "o")
                .replace(/ses$/, "s")
            : segment.endsWith("s") && !segment.endsWith("ss")
              ? segment.slice(0, -1)
              : segment
      return singular.charAt(0).toUpperCase() + singular.slice(1).toLowerCase()
    })
    .join("")
}

function skip_string_and_comments(s: string, i: number): number {
  const c = s[i]
  if (c === "/" && s[i + 1] === "/") {
    let j = i + 2
    while (j < s.length && s[j] !== "\n") j++
    return j
  }
  if (c === "/" && s[i + 1] === "*") {
    let j = i + 2
    while (j < s.length - 1 && !(s[j] === "*" && s[j + 1] === "/")) j++
    return j < s.length - 1 ? j + 2 : s.length
  }
  if (c === "'" || c === '"') {
    const quote = c
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
  return i
}

function brace_body_after(s: string, from_idx: number): { inner: string; end: number } | undefined {
  let i = from_idx
  while (i < s.length && s[i] !== "{") {
    const next = skip_string_and_comments(s, i)
    if (next !== i) {
      i = next
      continue
    }
    i++
  }
  if (i >= s.length || s[i] !== "{") return undefined
  let depth = 0
  const open = i
  let j = i
  while (j < s.length) {
    const skip = skip_string_and_comments(s, j)
    if (skip !== j) {
      j = skip
      continue
    }
    if (s[j] === "{") depth++
    else if (s[j] === "}") {
      depth--
      if (depth === 0) return { inner: s.slice(open + 1, j), end: j + 1 }
    }
    j++
  }
  return undefined
}

function read_quoted_literal(s: string, start_idx: number): { value: string; end: number } | undefined {
  let i = start_idx
  while (i < s.length && /\s/.test(s[i])) i++
  const quote = s[i]
  if (quote !== "'" && quote !== '"') return undefined
  let j = i + 1
  let buf = ""
  while (j < s.length) {
    if (s[j] === "\\" && j + 1 < s.length) {
      buf += s[j + 1]
      j += 2
      continue
    }
    if (s[j] === quote) return { value: buf, end: j + 1 }
    buf += s[j]
    j++
  }
  return undefined
}

const SCHEMA_FN_RE = /\bSchema::(create|table)\s*\(\s*/g

function collect_schema_ops(content: string, source_migration: string): PendingOp[] {
  const out: PendingOp[] = []
  SCHEMA_FN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SCHEMA_FN_RE.exec(content)) !== null) {
    const bail = () => {
      SCHEMA_FN_RE.lastIndex = m!.index + 1
    }
    const lit = read_quoted_literal(content, m.index + m[0].length)
    if (!lit) {
      bail()
      continue
    }
    const table_name = lit.value
    let k = lit.end
    while (k < content.length && /\s/.test(content[k])) k++
    if (content[k] !== ",") {
      bail()
      continue
    }
    k++
    while (k < content.length && /\s/.test(content[k])) k++
    const closure = /\bfunction\s*\([^)]*\)/.exec(content.slice(k))
    if (!closure) {
      bail()
      continue
    }
    k += closure.index + closure[0].length
    const body_result = brace_body_after(content, k)
    if (!body_result) {
      bail()
      continue
    }
    SCHEMA_FN_RE.lastIndex = body_result.end
    out.push({ table: table_name, body: body_result.inner, source_migration })
  }
  return out
}

type MutableField = Omit<Field, "isPK" | "isFK" | "isUnique" | "isOptional"> &
  Partial<Pick<Field, "isPK" | "isFK" | "isUnique" | "isOptional">>

function finalize_field(m: MutableField): Field {
  return {
    name: m.name,
    type: m.type,
    isPK: m.isPK ?? false,
    isFK: m.isFK ?? false,
    isUnique: m.isUnique ?? false,
    isOptional: m.isOptional ?? false,
  }
}

function parse_method_statement(
  stmt: string,
): { method: string; rest_chain: string; first_arg?: string } | undefined {
  const head = /^(\w+)\s*\(\s*/.exec(stmt)
  if (!head) return undefined
  const method = head[1]
  let i = head[0].length
  if (stmt[i] === "'" || stmt[i] === '"') {
    const lit = read_quoted_literal(stmt, i)
    if (!lit) return { method, rest_chain: stmt.slice(i), first_arg: undefined }
    const rest = stmt.slice(lit.end)
    return { method, rest_chain: rest, first_arg: lit.value }
  }
  if (stmt[i] === ")") {
    return { method, rest_chain: stmt.slice(i + 1), first_arg: undefined }
  }
  const close_paren = stmt.indexOf(")", i)
  if (close_paren >= 0) {
    const inner = stmt.slice(i, close_paren).trim()
    return { method, rest_chain: stmt.slice(close_paren + 1), first_arg: inner || undefined }
  }
  return { method, rest_chain: stmt.slice(i), first_arg: undefined }
}

function split_table_statements(body: string): string[] {
  const statements: string[] = []
  const parts = body.split("$table->")
  for (let pi = 1; pi < parts.length; pi++) {
    let chunk = parts[pi]
    let depth_paren = 0
    let end = -1
    for (let idx = 0; idx < chunk.length; idx++) {
      const sk = skip_string_and_comments(chunk, idx)
      if (sk !== idx) {
        idx = sk - 1
        continue
      }
      const ch = chunk[idx]
      if (ch === "(") depth_paren++
      else if (ch === ")") depth_paren--
      else if (ch === ";" && depth_paren === 0) {
        end = idx
        break
      }
    }
    if (end >= 0) chunk = chunk.slice(0, end)
    const t = chunk.trim()
    if (t) statements.push(t)
  }
  return statements
}

function laravel_column_type(method: string, first_arg?: string): string {
  switch (method) {
    case "id":
      return "id"
    case "uuid":
      return "uuid"
    case "foreignId":
      return "foreignId"
    case "foreignUuid":
      return "foreignUuid"
    case "foreignUlid":
      return "foreignUlid"
    case "binary":
      return "binary"
    case "tinyInteger":
    case "unsignedTinyInteger":
      return first_arg !== undefined ? `tinyInteger:${first_arg}` : "tinyInteger"
    case "smallInteger":
    case "unsignedSmallInteger":
      return first_arg !== undefined ? `smallInteger:${first_arg}` : "smallInteger"
    case "integer":
    case "unsignedInteger":
      return first_arg !== undefined ? `integer:${first_arg}` : "integer"
    case "bigInteger":
    case "unsignedBigInteger":
      return first_arg !== undefined ? `bigint:${first_arg}` : "bigint"
    case "decimal":
      return first_arg ?? "decimal"
    case "float":
    case "double":
      return first_arg ?? method
    case "boolean":
      return "boolean"
    case "date":
    case "dateTime":
    case "datetime":
    case "timestamp":
      return method
    case "time":
      return "time"
    case "year":
      return "year"
    case "char":
    case "string":
    case "text":
    case "mediumText":
    case "longText":
      return first_arg !== undefined ? `${method}:${first_arg}` : method
    case "json":
    case "jsonb":
      return method
    case "morphs":
      return first_arg !== undefined ? `morphs:${first_arg}` : "morphs"
    case "nullableMorphs":
      return first_arg !== undefined ? `nullableMorphs:${first_arg}` : "nullableMorphs"
    default:
      return first_arg !== undefined ? `${method}:${first_arg}` : method
  }
}

function infer_unique(full_stmt: string): boolean {
  return /->(?:unique|uniqueIndex)\s*\(/.test(full_stmt)
}

function infer_nullable(full_stmt: string): boolean {
  return /->nullable\s*\(/.test(full_stmt)
}

function infer_pk_chain(full_stmt: string): boolean {
  return /->(?:primary)\s*\(\s*\)/.test(full_stmt)
}

type ForeignKeyDraft = { local_column: string; stmt: string }

function apply_statements(params: {
  fields_by_name: Map<string, MutableField>
  pending_relations: Relation[]
  fk_drafts: ForeignKeyDraft[]
  current_model_display: string
  statements: string[]
}): void {
  const { fields_by_name, pending_relations, fk_drafts, current_model_display, statements } = params

  for (const stmt of statements) {
    const full = `$table->${stmt}`
    const parsed = parse_method_statement(stmt)
    if (!parsed) continue
    const { method, first_arg } = parsed

    if (method === "timestamps" || method === "nullableTimestamps") {
      const nullable = method === "nullableTimestamps"
      fields_by_name.set("created_at", {
        name: "created_at",
        type: nullable ? "timestamp?" : "timestamp",
        isOptional: nullable,
      })
      fields_by_name.set("updated_at", {
        name: "updated_at",
        type: nullable ? "timestamp?" : "timestamp",
        isOptional: nullable,
      })
      continue
    }
    if (method === "softDeletes" || method === "softDeletesTz") {
      fields_by_name.set("deleted_at", { name: "deleted_at", type: "timestamp?", isOptional: true })
      continue
    }
    if (method === "rememberToken") {
      fields_by_name.set("remember_token", { name: "remember_token", type: "string:100", isOptional: true })
      continue
    }

    if (method === "id") {
      fields_by_name.set("id", {
        name: "id",
        type: laravel_column_type("id"),
        isPK: true,
      })
      continue
    }

    if (method === "increments") {
      const name = first_arg ?? "id"
      fields_by_name.set(name, {
        name,
        type: laravel_column_type("integer", name),
        isPK: first_arg !== undefined ? infer_pk_chain(full) : true,
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      continue
    }

    if (method === "bigIncrements") {
      const name = first_arg ?? "id"
      fields_by_name.set(name, {
        name,
        type: "bigint",
        isPK: true,
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      continue
    }

    if (method === "unsignedBigInteger" && first_arg) {
      fields_by_name.set(first_arg, {
        name: first_arg,
        type: "bigint",
        isPK: infer_pk_chain(full),
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      continue
    }

    if (method === "foreignId" || method === "foreignUuid" || method === "foreignUlid") {
      const col = first_arg
      if (!col) continue
      const ty = method === "foreignId" ? "foreignId" : method === "foreignUuid" ? "uuid" : "ulid"
      fields_by_name.set(col, {
        name: col,
        type: ty,
        isFK: true,
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      const constrained_named = full.match(/constrained\s*\(\s*['"]([^'"]+)['"]\s*\)/)
      const ref_table = constrained_named?.[1] ?? infer_referenced_table_from_column(col)
      const ref_col_m = full.match(/references\s*\(\s*['"]([^'"]+)['"]\s*\)/)
      const ref_col = ref_col_m?.[1] ?? "id"
      if (ref_table) {
        pending_relations.push({
          fromModel: current_model_display,
          fromField: col,
          toModel: table_name_to_display_model(ref_table),
          toField: ref_col,
        })
      }
      continue
    }

    if (method === "foreign" && first_arg) {
      fk_drafts.push({ local_column: first_arg, stmt: full })
      continue
    }

    if (
      method === "morphs" ||
      method === "nullableMorphs" ||
      method === "uuidMorphs" ||
      method === "nullableUuidMorphs"
    ) {
      const base = first_arg
      if (!base) continue
      const id_col = `${base}_id`
      const type_col = `${base}_type`
      const id_type = method.includes("uuid") ? "uuid" : "bigint"
      fields_by_name.set(id_col, {
        name: id_col,
        type: id_type,
        isFK: false,
        isOptional: method.startsWith("nullable"),
      })
      fields_by_name.set(type_col, {
        name: type_col,
        type: "string",
        isOptional: method.startsWith("nullable"),
      })
      continue
    }

    const named_methods = new Set([
      "string",
      "char",
      "text",
      "mediumText",
      "longText",
      "integer",
      "tinyInteger",
      "smallInteger",
      "bigInteger",
      "unsignedInteger",
      "unsignedTinyInteger",
      "unsignedSmallInteger",
      "decimal",
      "float",
      "double",
      "boolean",
      "date",
      "dateTime",
      "datetime",
      "timestamp",
      "time",
      "year",
      "binary",
      "json",
      "jsonb",
      "uuid",
    ])

    if (named_methods.has(method) && first_arg) {
      fields_by_name.set(first_arg, {
        name: first_arg,
        type: laravel_column_type(method, first_arg),
        isPK: infer_pk_chain(full),
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      continue
    }

    if (method === "enum" && first_arg) {
      fields_by_name.set(first_arg, {
        name: first_arg,
        type: "enum",
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
      continue
    }

    if (["dropColumn", "dropForeign", "dropUnique", "dropIndex", "renameColumn", "rename"].includes(method)) {
      continue
    }

    if (first_arg) {
      fields_by_name.set(first_arg, {
        name: first_arg,
        type: laravel_column_type(method, first_arg),
        isPK: infer_pk_chain(full),
        isUnique: infer_unique(full),
        isOptional: infer_nullable(full),
      })
    }
  }
}

function resolve_foreign_key_drafts(
  drafts: ForeignKeyDraft[],
  fields_by_name: Map<string, MutableField>,
  pending_relations: Relation[],
  current_model_display: string,
): void {
  for (const d of drafts) {
    const ref_m = d.stmt.match(/references\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    const on_m = d.stmt.match(/on\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    const ref_col = ref_m?.[1] ?? "id"
    const ref_table = on_m?.[1]
    if (!ref_table) continue
    const col = d.local_column
    const existing = fields_by_name.get(col)
    if (existing) existing.isFK = true
    else fields_by_name.set(col, { name: col, type: "bigint", isFK: true })

    pending_relations.push({
      fromModel: current_model_display,
      fromField: col,
      toModel: table_name_to_display_model(ref_table),
      toField: ref_col,
    })
  }
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

function build_schema(ops: PendingOp[]): SchemaData {
  /** table name (DB) → column map */
  const table_fields_maps = new Map<string, Map<string, MutableField>>()
  /** First migration file (in chronological op order) that defines this table — owns `Model.group`. */
  const table_intro_migration = new Map<string, string>()
  const raw_relations: Relation[] = []

  for (const op of ops) {
    const display = table_name_to_display_model(op.table)
    const fields_by_name = new Map<string, MutableField>()
    const fk_drafts: ForeignKeyDraft[] = []

    apply_statements({
      fields_by_name,
      pending_relations: raw_relations,
      fk_drafts,
      current_model_display: display,
      statements: split_table_statements(op.body),
    })
    resolve_foreign_key_drafts(fk_drafts, fields_by_name, raw_relations, display)

    let field_map = table_fields_maps.get(op.table)
    if (!field_map) {
      field_map = new Map()
      table_fields_maps.set(op.table, field_map)
      table_intro_migration.set(op.table, op.source_migration)
    }
    for (const [fname, fld] of fields_by_name.entries()) field_map.set(fname, fld)
  }

  const models: Model[] = []
  const models_by_group: Record<string, Model[]> = {}

  for (const [table_name, col_map] of table_fields_maps.entries()) {
    const fields = [...col_map.values()].map(finalize_field)
    const model_name = table_name_to_display_model(table_name)
    const group =
      table_intro_migration.get(table_name) ?? ops[0]?.source_migration ?? "migrations"

    const model: Model = {
      name: model_name,
      tableName: table_name,
      group,
      fields,
    }
    models.push(model)
    models_by_group[group] ??= []
    models_by_group[group].push(model)
  }

  models.sort((a, b) => a.tableName.localeCompare(b.tableName))

  return {
    models,
    relations: dedupe_relations(raw_relations),
    modelsByGroup: models_by_group,
    parserName: "laravel",
  }
}

function is_laravel_migration_name(base_without_ext: string): boolean {
  return /^\d{4}_\d{2}_\d{2}_\d{6}_/.test(base_without_ext)
}

function discover_files(project_root: string): string[] {
  return collect_files_recursive({
    project_root,
    basename_match: (name) => {
      if (!name.toLowerCase().endsWith(".php")) return false
      const stem = name.slice(0, -4)
      return is_laravel_migration_name(stem)
    },
  })
}

function matches_single_file(abs_path: string): boolean {
  const stem = path.basename(abs_path).replace(/\.php$/i, "")
  return abs_path.toLowerCase().endsWith(".php") && is_laravel_migration_name(stem)
}

function parse_files(abs_paths: string[], project_root: string): SchemaData {
  const sorted = [...abs_paths].sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  const all_ops: PendingOp[] = []
  for (const file_path of sorted) {
    const content = readFileSync(file_path, "utf-8")
    const source_migration =
      path.relative(project_root, file_path).replace(/\\/g, "/") || path.basename(file_path)
    all_ops.push(...collect_schema_ops(content, source_migration))
  }
  return build_schema(all_ops)
}

export const laravelParser: Parser = {
  id: "laravel",
  name: "Laravel migrations",
  file_requirement_hint: "Expected a Laravel migration named YYYY_MM_DD_HHmmss_*.php",
  discover_files,
  matches_single_file,
  parse_files,
}
