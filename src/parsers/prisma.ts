import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import path from "path"

import type { Field, Model, Relation, SchemaData } from "../types"
import type { Parser } from "./index"

/*
 * Preferred column order when multiple .prisma files are present in a directory.
 * Files not in this list are appended alphabetically after.
 */
const PREFERRED_ORDER = ["user", "intermediary", "principal", "department", "staff", "product", "audit"]

function sort_key(filename: string): number {
  const base = filename.replace(".prisma", "")
  const idx = PREFERRED_ORDER.indexOf(base)
  return idx === -1 ? PREFERRED_ORDER.length : idx
}

function read_schema_files(input_path: string): Array<{ file: string; content: string }> {
  if (statSync(input_path).isDirectory()) {
    return readdirSync(input_path)
      .filter((f) => f.endsWith(".prisma") && f !== "base.prisma")
      .sort((a, b) => sort_key(a) - sort_key(b) || a.localeCompare(b))
      .map((f) => ({ file: f, content: readFileSync(path.join(input_path, f), "utf-8") }))
  }
  return [{ file: path.basename(input_path), content: readFileSync(input_path, "utf-8") }]
}

function parse(input_path: string): SchemaData {
  const files = read_schema_files(input_path)
  const combined = files.map((f) => f.content).join("\n")

  // First pass: collect model names so we can distinguish them from scalars/enums
  const model_names = new Set<string>()
  for (const m of combined.matchAll(/^model\s+(\w+)\s*\{/gm)) model_names.add(m[1])

  const all_models: Model[] = []
  const all_relations: Relation[] = []
  const models_by_group: Record<string, Model[]> = {}

  for (const { file, content } of files) {
    const file_models: Model[] = []

    for (const match of content.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^}/gm)) {
      const model_name = match[1]
      const body = match[2]

      const map_match = body.match(/@@map\("([^"]+)"\)/)
      const table_name = map_match ? map_match[1] : model_name

      const fields: Field[] = []
      const fk_field_names = new Set<string>()

      for (const line of body.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("///") || trimmed.startsWith("@@")) continue

        const parts = trimmed.match(/^(\w+)\s+(\S+)\s*(.*)$/)
        if (!parts) continue
        const [, field_name, raw_type, rest] = parts
        const base_type = raw_type.replace("?", "").replace("[]", "")

        // Virtual relation field — type resolves to another model
        if (model_names.has(base_type)) {
          const fields_m = rest.match(/fields:\s*\[([^\]]+)\]/)
          const refs_m = rest.match(/references:\s*\[([^\]]+)\]/)
          if (fields_m && refs_m) {
            const fks = fields_m[1].split(",").map((s) => s.trim())
            const refs = refs_m[1].split(",").map((s) => s.trim())
            fks.forEach((fk) => fk_field_names.add(fk))
            for (let i = 0; i < fks.length; i++) {
              all_relations.push({ fromModel: model_name, fromField: fks[i], toModel: base_type, toField: refs[i] })
            }
          }
          continue
        }

        fields.push({
          name: field_name,
          type: raw_type.includes("[]") ? `${base_type}[]` : base_type,
          isPK: rest.includes("@id"),
          isFK: false,
          isUnique: rest.includes("@unique"),
          isOptional: raw_type.includes("?"),
        })
      }

      for (const f of fields) {
        if (fk_field_names.has(f.name)) f.isFK = true
      }

      const model: Model = { name: model_name, tableName: table_name, group: file, fields }
      all_models.push(model)
      file_models.push(model)
    }

    if (file_models.length > 0) {
      models_by_group[file] = file_models
    }
  }

  return { models: all_models, relations: all_relations, modelsByGroup: models_by_group, parserName: "prisma" }
}

function detect(input_path: string): boolean {
  if (!existsSync(input_path)) return false
  if (statSync(input_path).isDirectory()) {
    return readdirSync(input_path).some((f) => f.endsWith(".prisma"))
  }
  return input_path.endsWith(".prisma")
}

export const prismaParser: Parser = { name: "Prisma", detect, parse }
