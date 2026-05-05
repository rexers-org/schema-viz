import React, { useEffect, useMemo, useState } from "react"

import SchemaDiagram from "./SchemaDiagram"
import { GROUP_PALETTE, build_group_palette_map } from "./lib/palette"
import type { SchemaData } from "./types"

/** Mounted only when `data` is ready — keeps hook count stable and avoids parent early-return edge cases. */
function SchemaDiagramView({ data }: { data: SchemaData }) {
  const group_palette_map = useMemo(
    () => build_group_palette_map(data.models.map((m) => m.group)),
    [data],
  )

  const colored_models = data.models.map((m) => {
    const idx = group_palette_map.get(m.group) ?? 0
    const pal = GROUP_PALETTE[idx]
    return {
      ...m,
      headerColor: pal.header,
      relationStroke: pal.stroke,
      relationColorIndex: idx,
    }
  })

  return (
    <SchemaDiagram models={colored_models} relations={data.relations} parserName={data.parserName} />
  )
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

  return <SchemaDiagramView data={data} />
}
