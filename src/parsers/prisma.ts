import path from "path"
import { readFileSync } from "fs"

import { collect_files_recursive } from "@/lib/discovery"

import type { Field, Model, Relation, SchemaData } from "@/types"
import type { Parser } from "./index"

/*
 * Preferred column order when multiple .prisma files are present in a directory.
 * Files not in this list are appended alphabetically after.
 */
const PREFERRED_ORDER = ["user", "intermediary", "principal", "department", "staff", "product", "audit"]

function sort_key(filename: string): number {
  const base = filename.replace(/\.prisma$/i, "")
  const idx = PREFERRED_ORDER.indexOf(base)
  return idx === -1 ? PREFERRED_ORDER.length : idx
}

function read_schema_files(abs_paths: string[], project_root: string): Array<{ file: string; content: string }> {
  return abs_paths
    .map((abs) => ({
      file: path.relative(project_root, abs).replace(/\\/g, "/") || path.basename(abs),
      abs,
      content: readFileSync(abs, "utf-8"),
    }))
    .sort(
      (a, b) =>
        sort_key(path.basename(a.file)) - sort_key(path.basename(b.file)) || a.file.localeCompare(b.file),
    )
    .map(({ file, content }) => ({ file, content }))
}

function parse_files(abs_paths: string[], project_root: string): SchemaData {
  const files = read_schema_files(abs_paths, project_root)
  const combined = files.map((f) => f.content).join("\n")

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

        if (model_names.has(base_type)) {
          const fields_m = rest.match(/fields:\s*\[([^\]]+)\]/)
          const refs_m = rest.match(/references:\s*\[([^\]]+)\]/)
          if (fields_m && refs_m) {
            const fks = fields_m[1].split(",").map((s) => s.trim())
            const refs = refs_m[1].split(",").map((s) => s.trim())
            fks.forEach((fk) => fk_field_names.add(fk))
            for (let i = 0; i < fks.length; i++) {
              all_relations.push({
                fromModel: model_name,
                fromField: fks[i],
                toModel: base_type,
                toField: refs[i],
              })
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

function discover_files(project_root: string): string[] {
  return collect_files_recursive({
    project_root,
    basename_match: (name) => name.endsWith(".prisma") && name !== "base.prisma",
  })
}

function matches_single_file(abs_path: string): boolean {
  const base = path.basename(abs_path).toLowerCase()
  return base.endsWith(".prisma") && base !== "base.prisma"
}

export const prismaParser: Parser = {
  id: "prisma",
  name: "Prisma",
  file_requirement_hint: "Expected a *.prisma file (excluding base.prisma)",
  discover_files,
  matches_single_file,
  parse_files,
}
