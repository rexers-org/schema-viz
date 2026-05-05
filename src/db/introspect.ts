import mysql from "mysql2/promise"
import pg from "pg"

import type { Field, Model, Relation, SchemaData } from "./types"

export type DbDialect = "postgresql" | "mysql"

/**
 * Turns SQL snake_case identifiers into PascalCase for diagram titles (tables / columns).
 * Segments split on `_`; each segment is title-cased. Empty segments from `__` are skipped.
 */
export function snake_case_to_pascal_case(raw: string): string {
  const s = raw.trim()
  if (!s) return raw
  const segments = s.split("_").filter((segment) => segment.length > 0)
  if (segments.length === 0) return s
  return segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join("")
}

export function detect_db_dialect(url: string): DbDialect | null {
  const s = url.trim().toLowerCase()
  if (s.startsWith("postgresql://") || s.startsWith("postgres://")) return "postgresql"
  if (s.startsWith("mysql://") || s.startsWith("mysql2://")) return "mysql"
  return null
}

/** Safe label for logs (password redacted). */
export function redact_database_url(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = "***"
    return u.href
  } catch {
    return "(invalid URL)"
  }
}

function pg_model_display_name(schema: string, table: string): string {
  const table_label = snake_case_to_pascal_case(table)
  if (schema === "public") return table_label
  return `${snake_case_to_pascal_case(schema)}.${table_label}`
}

function mysql_model_display_name(table: string): string {
  return snake_case_to_pascal_case(table)
}

function display_column_type(data_type: string, udt_name: string | null): string {
  if (data_type === "USER-DEFINED" && udt_name) return udt_name
  return data_type
}

export async function introspect_postgresql(pool: pg.Pool): Promise<SchemaData> {
  const tables_r = await pool.query<{
    table_schema: string
    table_name: string
  }>(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name`,
  )

  const cols_r = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
    is_nullable: string
    ordinal_position: number
  }>(
    `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, ordinal_position
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, ordinal_position`,
  )

  const pk_r = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
  }>(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
       AND tc.constraint_schema = kcu.constraint_schema
       AND tc.constraint_name = kcu.constraint_name
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`,
  )

  const unique_r = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
  }>(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
       AND tc.constraint_schema = kcu.constraint_schema
       AND tc.constraint_name = kcu.constraint_name
     WHERE tc.constraint_type = 'UNIQUE'
       AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND (
         SELECT COUNT(*)::int FROM information_schema.key_column_usage k2
         WHERE k2.constraint_catalog = tc.constraint_catalog
           AND k2.constraint_schema = tc.constraint_schema
           AND k2.constraint_name = tc.constraint_name
       ) = 1`,
  )

  const fk_r = await pool.query<{
    src_schema: string
    src_table: string
    src_col: string
    ref_schema: string
    ref_table: string
    ref_col: string
  }>(
    `SELECT
       ns.nspname AS src_schema,
       cl.relname AS src_table,
       sa.attname AS src_col,
       nrf.nspname AS ref_schema,
       rfl.relname AS ref_table,
       ra.attname AS ref_col
     FROM pg_constraint c
     JOIN pg_class cl ON cl.oid = c.conrelid
     JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     JOIN pg_class rfl ON rfl.oid = c.confrelid
     JOIN pg_namespace nrf ON nrf.oid = rfl.relnamespace
     JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
     JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
     JOIN pg_attribute sa ON sa.attrelid = cl.oid AND sa.attnum = ck.attnum AND NOT sa.attisdropped
     JOIN pg_attribute ra ON ra.attrelid = rfl.oid AND ra.attnum = fk.attnum AND NOT ra.attisdropped
     WHERE c.contype = 'f'
       AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
  )

  const pk_set = new Set(
    pk_r.rows.map((r) => `${r.table_schema}\0${r.table_name}\0${r.column_name}`),
  )
  const unique_set = new Set(
    unique_r.rows.map((r) => `${r.table_schema}\0${r.table_name}\0${r.column_name}`),
  )

  const models: Model[] = []
  const models_by_group: Record<string, Model[]> = {}
  const model_name_by_table = new Map<string, string>()

  for (const t of tables_r.rows) {
    const name = pg_model_display_name(t.table_schema, t.table_name)
    model_name_by_table.set(`${t.table_schema}\0${t.table_name}`, name)
    const group = `${t.table_schema}:${t.table_name}`
    const table_cols = cols_r.rows.filter(
      (c) => c.table_schema === t.table_schema && c.table_name === t.table_name,
    )
    const fields: Field[] = table_cols.map((c) => {
      const key = `${c.table_schema}\0${c.table_name}\0${c.column_name}`
      return {
        name: snake_case_to_pascal_case(c.column_name),
        type: display_column_type(c.data_type, c.udt_name),
        isPK: pk_set.has(key),
        isFK: false,
        isUnique: unique_set.has(key),
        isOptional: c.is_nullable === "YES",
      }
    })
    const m: Model = { name, tableName: t.table_name, group, fields }
    models.push(m)
    models_by_group[group] = [m]
  }

  const fk_field_keys = new Set<string>()
  const relations: Relation[] = []

  const resolve_pg_model = (schema: string, table: string): string | undefined =>
    model_name_by_table.get(`${schema}\0${table}`)

  for (const r of fk_r.rows) {
    const from_model = resolve_pg_model(r.src_schema, r.src_table)
    const to_model = resolve_pg_model(r.ref_schema, r.ref_table)
    if (!from_model || !to_model) continue
    const from_field = snake_case_to_pascal_case(r.src_col)
    const to_field = snake_case_to_pascal_case(r.ref_col)
    fk_field_keys.add(`${from_model}\0${from_field}`)
    relations.push({
      fromModel: from_model,
      fromField: from_field,
      toModel: to_model,
      toField: to_field,
    })
  }

  for (const m of models) {
    for (const f of m.fields) {
      if (fk_field_keys.has(`${m.name}\0${f.name}`)) f.isFK = true
    }
  }

  return { models, relations, modelsByGroup: models_by_group, parserName: "postgresql-db" }
}

export async function introspect_mysql(pool: mysql.Pool): Promise<SchemaData> {
  const [db_rows] = await pool.query<mysql.RowDataPacket[]>("SELECT DATABASE() AS db")
  const raw_db = db_rows[0] ? (db_rows[0] as { db: string | null }).db : null
  const db_name = raw_db ? String(raw_db) : null
  if (!db_name)
    throw new Error("MySQL connection has no default database — include the database name in the URL path.")

  const tables_r = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME`,
    [db_name],
  )

  const cols_r = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, ORDINAL_POSITION
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [db_name],
  )

  const pk_r = await pool.query<mysql.RowDataPacket[]>(
    `SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME
     FROM information_schema.TABLE_CONSTRAINTS tc
     JOIN information_schema.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = ?`,
    [db_name],
  )

  const unique_r = await pool.query<mysql.RowDataPacket[]>(
    `SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME
     FROM information_schema.TABLE_CONSTRAINTS tc
     JOIN information_schema.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_TYPE = 'UNIQUE' AND tc.TABLE_SCHEMA = ?
       AND (
         SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k2
         WHERE k2.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k2.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       ) = 1`,
    [db_name],
  )

  const fk_r = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       kcu.TABLE_SCHEMA AS src_schema,
       kcu.TABLE_NAME AS src_table,
       kcu.COLUMN_NAME AS src_col,
       kcu.REFERENCED_TABLE_SCHEMA AS ref_schema,
       kcu.REFERENCED_TABLE_NAME AS ref_table,
       kcu.REFERENCED_COLUMN_NAME AS ref_col
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND kcu.TABLE_SCHEMA = ?`,
    [db_name],
  )

  const pk_set = new Set(
    pk_r[0].map((r: mysql.RowDataPacket) =>
      `${r.TABLE_SCHEMA}\0${r.TABLE_NAME}\0${r.COLUMN_NAME}`.toLowerCase(),
    ),
  )
  const unique_set = new Set(
    unique_r[0].map((r: mysql.RowDataPacket) =>
      `${r.TABLE_SCHEMA}\0${r.TABLE_NAME}\0${r.COLUMN_NAME}`.toLowerCase(),
    ),
  )

  const models: Model[] = []
  const models_by_group: Record<string, Model[]> = {}
  for (const row of tables_r[0]) {
    const TABLE_NAME = row.TABLE_NAME as string
    const SCHEMA = row.TABLE_SCHEMA as string
    const group_label = `${db_name}:${TABLE_NAME}`
    const name = mysql_model_display_name(TABLE_NAME)
    const table_cols = cols_r[0].filter(
      (c: mysql.RowDataPacket) => c.TABLE_NAME === TABLE_NAME && c.TABLE_SCHEMA === SCHEMA,
    )
    const fields: Field[] = table_cols.map((c: mysql.RowDataPacket) => {
      const key = `${c.TABLE_SCHEMA}\0${c.TABLE_NAME}\0${c.COLUMN_NAME}`.toLowerCase()
      return {
        name: snake_case_to_pascal_case(String(c.COLUMN_NAME)),
        type: (c.COLUMN_TYPE as string) || (c.DATA_TYPE as string),
        isPK: pk_set.has(key),
        isFK: false,
        isUnique: unique_set.has(key),
        isOptional: String(c.IS_NULLABLE).toUpperCase() === "YES",
      }
    })
    const m: Model = { name, tableName: TABLE_NAME, group: group_label, fields }
    models.push(m)
    models_by_group[group_label] = [m]
  }

  const model_by_table = new Map<string, string>()
  for (const m of models) model_by_table.set(m.tableName.toLowerCase(), m.name)

  const fk_field_keys = new Set<string>()
  const relations: Relation[] = []

  for (const row of fk_r[0]) {
    const src_table = row.src_table as string
    const ref_table = row.ref_table as string
    const from_model = model_by_table.get(String(src_table).toLowerCase())
    const to_model = model_by_table.get(String(ref_table).toLowerCase())
    if (!from_model || !to_model) continue
    const from_field = snake_case_to_pascal_case(String(row.src_col))
    const to_field = snake_case_to_pascal_case(String(row.ref_col))
    fk_field_keys.add(`${from_model}\0${from_field}`)
    relations.push({
      fromModel: from_model,
      fromField: from_field,
      toModel: to_model,
      toField: to_field,
    })
  }

  for (const m of models) {
    for (const f of m.fields) {
      if (fk_field_keys.has(`${m.name}\0${f.name}`)) f.isFK = true
    }
  }

  return { models, relations, modelsByGroup: models_by_group, parserName: "mysql-db" }
}

export async function introspect_live_database(params: {
  dialect: DbDialect
  pg_pool?: pg.Pool
  mysql_pool?: mysql.Pool
}): Promise<SchemaData> {
  if (params.dialect === "postgresql") {
    if (!params.pg_pool) throw new Error("Internal error: PostgreSQL pool missing.")
    return introspect_postgresql(params.pg_pool)
  }
  if (!params.mysql_pool) throw new Error("Internal error: MySQL pool missing.")
  return introspect_mysql(params.mysql_pool)
}

export function create_postgresql_pool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 5 })
}

export function create_mysql_pool(url: string): mysql.Pool {
  return mysql.createPool({ uri: url, connectionLimit: 5 })
}
