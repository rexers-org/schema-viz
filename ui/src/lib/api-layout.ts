import type { TablePositionsMap } from "./table-positions"

export type SavedLayout = {
  v: 1
  sigHash: string
  positions: TablePositionsMap
}

export async function fetch_layout(): Promise<SavedLayout | null> {
  try {
    const res = await fetch("/api/layout")
    if (!res.ok) return null
    const data = await res.json() as SavedLayout | null
    if (!data || data.v !== 1) return null
    return data
  } catch {
    return null
  }
}

export function save_layout(data: SavedLayout): void {
  void fetch("/api/layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export function clear_layout(): void {
  void fetch("/api/layout", { method: "DELETE" })
}
