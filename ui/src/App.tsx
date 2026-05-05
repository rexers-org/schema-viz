import { useEffect, useState } from "react"

import SchemaDiagram from "./SchemaDiagram"
import type { SchemaData } from "./types"

const HEADER_H = 44
const FIELD_H = 30
const CARD_W = 264
const COL_GAP = 100
const ROW_GAP = 50
const PADDING = 40

// Deterministic color per group name so it's stable across reloads
const COLORS = [
  "bg-blue-700",
  "bg-violet-700",
  "bg-amber-700",
  "bg-emerald-700",
  "bg-rose-700",
  "bg-teal-700",
  "bg-slate-600",
  "bg-orange-700",
  "bg-cyan-700",
]

function group_color(group: string): string {
  let h = 0
  for (const c of group) h = ((h * 31 + c.charCodeAt(0)) & 0xffff) >>> 0
  return COLORS[h % COLORS.length]
}

function compute_layout(data: SchemaData) {
  const positions: Record<string, { x: number; y: number }> = {}
  let col_x = PADDING
  let max_y = 0

  for (const group_models of Object.values(data.modelsByGroup)) {
    let row_y = PADDING
    for (const model of group_models) {
      positions[model.name] = { x: col_x, y: row_y }
      row_y += HEADER_H + model.fields.length * FIELD_H + ROW_GAP
    }
    max_y = Math.max(max_y, row_y)
    col_x += CARD_W + COL_GAP
  }

  return {
    positions,
    canvasW: col_x - COL_GAP + PADDING,
    canvasH: max_y + PADDING,
  }
}

export default function App() {
  const [data, set_data] = useState<SchemaData | null>(null)
  const [error, set_error] = useState<string | null>(null)

  const fetch_schema = () => {
    fetch("/api/schema")
      .then((r) => r.json())
      .then((d: SchemaData & { error?: string }) => {
        if (d.error) set_error(d.error)
        else {
          set_data(d)
          set_error(null)
        }
      })
      .catch((e: unknown) => set_error(String(e)))
  }

  useEffect(() => {
    fetch_schema()

    // SSE for live reload when schema files change
    const es = new EventSource("/api/events")
    es.onmessage = (e) => {
      if (e.data === "reload") fetch_schema()
    }
    return () => es.close()
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-8">
        <div className="text-red-400 font-mono text-sm bg-red-950/30 border border-red-900/50 rounded-lg p-6 max-w-xl w-full">
          <div className="font-bold mb-2 text-red-300">Parse error</div>
          <div className="text-red-400/70 whitespace-pre-wrap">{error}</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-gray-600 text-sm">Loading schema…</div>
      </div>
    )
  }

  const { positions, canvasW, canvasH } = compute_layout(data)
  const colored_models = data.models.map((m) => ({
    ...m,
    headerColor: group_color(m.group),
  }))

  return (
    <SchemaDiagram
      models={colored_models}
      relations={data.relations}
      positions={positions}
      canvasW={canvasW}
      canvasH={canvasH}
      parserName={data.parserName}
    />
  )
}
