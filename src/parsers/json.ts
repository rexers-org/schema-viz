import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import path from "path"

import type { Field, Model, Relation, SchemaData } from "../types"
import type { Parser } from "./index"

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

function parse_file(file_path: string): { models: Model[]; relations: Relation[]; group: string } {
  const group = path.basename(file_path)
  const raw: RawSchema = JSON.parse(readFileSync(file_path, "utf-8"))

  if (!Array.isArray(raw.models)) throw new Error(`${group}: missing "models" array`)

  const models: Model[] = raw.models.map((m) => {
    if (!m.name) throw new Error(`${group}: model missing "name"`)
    if (!Array.isArray(m.fields)) throw new Error(`${group}: model "${m.name}" missing "fields" array`)

    const fields: Field[] = m.fields.map((f) => {
      if (!f.name) throw new Error(`${group}: field in "${m.name}" missing "name"`)
      if (!f.type) throw new Error(`${group}: field "${f.name}" in "${m.name}" missing "type"`)
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
      group: m.group ?? group,
      fields,
    }
  })

  const relations: Relation[] = (raw.relations ?? []).map((r) => ({
    fromModel: r.fromModel,
    fromField: r.fromField,
    toModel: r.toModel,
    toField: r.toField,
  }))

  return { models, relations, group }
}

function parse(input_path: string): SchemaData {
  const files = statSync(input_path).isDirectory()
    ? readdirSync(input_path)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => path.join(input_path, f))
    : [input_path]

  const all_models: Model[] = []
  const all_relations: Relation[] = []
  const models_by_group: Record<string, Model[]> = {}

  for (const file_path of files) {
    const { models, relations, group } = parse_file(file_path)
    all_models.push(...models)
    all_relations.push(...relations)
    if (models.length > 0) models_by_group[group] = models
  }

  return { models: all_models, relations: all_relations, modelsByGroup: models_by_group, parserName: "json" }
}

function detect(input_path: string): boolean {
  if (!existsSync(input_path)) return false
  if (statSync(input_path).isDirectory()) {
    return readdirSync(input_path).some((f) => f.endsWith(".json"))
  }
  return input_path.endsWith(".json")
}

export const jsonParser: Parser = { name: "JSON", detect, parse }
