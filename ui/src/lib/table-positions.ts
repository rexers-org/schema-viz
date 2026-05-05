import { clear_cookie, read_cookie, write_cookie } from "./cookie"

const COOKIE_NAME = "schema_viz_table_positions"
const MAX_AGE_SECONDS = 24 * 60 * 60

/** Bump when cookie shape changes; old entries are discarded. */
const STORAGE_VERSION = 2

export type TablePositionsMap = Record<string, { x: number; y: number }>

/** Stable key for persisted drag offsets: layout algo depends on model sizes + FK graph. */
export function schema_drag_key(
  models: readonly { name: string; fields: { length: number } }[],
  relations: readonly { fromModel: string; fromField: string; toModel: string; toField: string }[],
): string {
  const model_part = [...models]
    .map((m) => `${m.name}\x1f${m.fields.length}`)
    .sort((a, b) => a.localeCompare(b))
    .join("\x1e")
  const rel_part = [...relations]
    .map((r) => `${r.fromModel}\x1f${r.fromField}\x1f${r.toModel}\x1f${r.toField}`)
    .sort((a, b) => a.localeCompare(b))
    .join("\x1e")
  return `${model_part}\x00${rel_part}`
}

function prune_positions(
  raw: TablePositionsMap,
  valid_model_names: ReadonlySet<string>,
): TablePositionsMap {
  const out: TablePositionsMap = {}
  for (const [key, pt] of Object.entries(raw)) {
    if (!valid_model_names.has(key)) continue
    const x = Number(pt.x)
    const y = Number(pt.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out[key] = { x, y }
  }
  return out
}

/** Load persisted table coords; rejects wrong parser/version or mismatched layout signature. */
export function load_table_layout_cookie(
  parser_name: string,
  valid_model_names: ReadonlySet<string>,
  current_drag_key: string,
): TablePositionsMap {
  try {
    const raw = read_cookie(COOKIE_NAME)
    if (!raw) return {}

    const o = JSON.parse(raw) as {
      v?: unknown
      parserName?: unknown
      schemaSignature?: unknown
      positions?: unknown
    }

    if (
      o.v !== STORAGE_VERSION ||
      typeof o.parserName !== "string" ||
      o.parserName !== parser_name ||
      typeof o.schemaSignature !== "string" ||
      o.schemaSignature !== current_drag_key
    ) {
      return {}
    }

    if (!o.positions || typeof o.positions !== "object" || Array.isArray(o.positions)) {
      return {}
    }

    return prune_positions(o.positions as TablePositionsMap, valid_model_names)
  } catch {
    return {}
  }
}

export function save_table_layout_cookie(
  parser_name: string,
  positions: TablePositionsMap,
  schema_signature: string,
): void {
  const cleaned = prune_positions(positions, new Set(Object.keys(positions)))
  write_cookie(
    COOKIE_NAME,
    JSON.stringify({
      v: STORAGE_VERSION,
      parserName: parser_name,
      schemaSignature: schema_signature,
      positions: cleaned,
    }),
    MAX_AGE_SECONDS,
  )
}

export function clear_table_layout_cookie(): void {
  clear_cookie(COOKIE_NAME)
}
