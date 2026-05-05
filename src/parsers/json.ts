import { readFileSync } from "fs"
import path from "path"

import { collect_files_recursive } from "@/lib/discovery"

import type { Field, Model, Relation, SchemaData } from "@/types"
import type { Parser } from "./index"

const SKIP_JSON_BASENAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "composer.lock",
])

type RawField = {
  name: string
  type: string
  isPK?: boolean
  isFK?: boolean
  isUnique?: boolean
  isOptional?: boolean
}

type RawModel = {
  name: string
  tableName?: string
  group?: string
  fields: RawField[]
}

type RawRelation = {
  fromModel: string
  fromField: string
  toModel: string
  toField: string
}

type RawSchema = {
  models: RawModel[]
  relations?: RawRelation[]
}

function parse_file(file_path: string, project_root: string): { models: Model[]; relations: Relation[]; group: string } {
  const group_tag =
    path.relative(project_root, file_path).replace(/\\/g, "/") || path.basename(file_path)
  const raw: RawSchema = JSON.parse(readFileSync(file_path, "utf-8"))

  if (!Array.isArray(raw.models)) throw new Error(`${group_tag}: missing "models" array`)

  const models: Model[] = raw.models.map((m) => {
    if (!m.name) throw new Error(`${group_tag}: model missing "name"`)
    if (!Array.isArray(m.fields)) throw new Error(`${group_tag}: model "${m.name}" missing "fields" array`)

    const fields: Field[] = m.fields.map((f) => {
      if (!f.name) throw new Error(`${group_tag}: field in "${m.name}" missing "name"`)
      if (!f.type) throw new Error(`${group_tag}: field "${f.name}" in "${m.name}" missing "type"`)
      return {
        name: f.name,
        type: f.type,
        isPK: f.isPK ?? false,
        isFK: f.isFK ?? false,
        isUnique: f.isUnique ?? false,
        isOptional: f.isOptional ?? false,
      }
    })

    return {
      name: m.name,
      tableName: m.tableName ?? m.name,
      group: m.group ?? group_tag,
      fields,
    }
  })

  const relations: Relation[] = (raw.relations ?? []).map((r) => ({
    fromModel: r.fromModel,
    fromField: r.fromField,
    toModel: r.toModel,
    toField: r.toField,
  }))

  return { models, relations, group: group_tag }
}

function parse_files(abs_paths: string[], project_root: string): SchemaData {
  const sorted = [...abs_paths].sort((a, b) => a.localeCompare(b))

  const all_models: Model[] = []
  const all_relations: Relation[] = []
  const models_by_group: Record<string, Model[]> = {}

  for (const file_path of sorted) {
    const { models, relations, group } = parse_file(file_path, project_root)
    all_models.push(...models)
    all_relations.push(...relations)
    if (models.length > 0) models_by_group[group] = models
  }

  return {
    models: all_models,
    relations: all_relations,
    modelsByGroup: models_by_group,
    parserName: "json",
  }
}

function discover_files(project_root: string): string[] {
  return collect_files_recursive({
    project_root,
    basename_match: (name) => name.toLowerCase().endsWith(".json") && !SKIP_JSON_BASENAMES.has(name),
  })
}

function matches_single_file(abs_path: string): boolean {
  const base = path.basename(abs_path)
  return abs_path.toLowerCase().endsWith(".json") && !SKIP_JSON_BASENAMES.has(base)
}

export const jsonParser: Parser = {
  id: "json",
  name: "JSON",
  file_requirement_hint: "Expected a *.json schema file containing a top-level \"models\" array",
  discover_files,
  matches_single_file,
  parse_files,
}
