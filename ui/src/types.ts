// Mirrors src/types.ts — the shape returned by GET /api/schema

export type Field = {
  name: string
  type: string
  isPK: boolean
  isFK: boolean
  isUnique: boolean
  isOptional: boolean
}

export type Model = {
  name: string
  tableName: string
  group: string
  fields: Field[]
}

export type Relation = {
  fromModel: string
  fromField: string
  toModel: string
  toField: string
}

export type SchemaData = {
  models: Model[]
  relations: Relation[]
  modelsByGroup: Record<string, Model[]>
  parserName: string
}
