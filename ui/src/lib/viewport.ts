import { clear_cookie, read_cookie, write_cookie } from "./cookie"

const COOKIE_NAME = "schema_viz_viewport"
const MAX_AGE_SECONDS = 24 * 60 * 60
const STORAGE_VERSION = 1

export type PersistedViewport = { x: number; y: number; zoom: number }

function clamp_zoom(z: number): number {
  return Math.max(0.1, Math.min(4, z))
}

export function load_viewport_cookie(parser_name: string): PersistedViewport | null {
  try {
    const raw = read_cookie(COOKIE_NAME)
    if (!raw) return null
    const o = JSON.parse(raw) as {
      v?: number
      parserName?: string
      x?: unknown
      y?: unknown
      zoom?: unknown
    }

    if (o.v !== STORAGE_VERSION || typeof o.parserName !== "string" || o.parserName !== parser_name) {
      return null
    }

    const x = Number(o.x)
    const y = Number(o.y)
    const zoom = Number(o.zoom)

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null

    return { x, y, zoom: clamp_zoom(zoom) }
  } catch {
    return null
  }
}

export function save_viewport_cookie(data: PersistedViewport & { parserName: string }): void {
  write_cookie(
    COOKIE_NAME,
    JSON.stringify({
      v: STORAGE_VERSION,
      parserName: data.parserName,
      x: data.x,
      y: data.y,
      zoom: clamp_zoom(data.zoom),
    }),
    MAX_AGE_SECONDS,
  )
}

export function clear_viewport_cookie(): void {
  clear_cookie(COOKIE_NAME)
}
