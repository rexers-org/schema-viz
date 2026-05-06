import React, { useEffect, useMemo, useState } from "react"

import SchemaDiagram from "./SchemaDiagram"
import { fetch_layout, type SavedLayout } from "./lib/api-layout"
import { GROUP_PALETTE, build_group_palette_map } from "./lib/palette"
import type { SchemaData } from "./types"

type DiagramData = { schema: SchemaData; layout: SavedLayout | null }

function SchemaDiagramView({ data }: { data: DiagramData }) {
  const group_palette_map = useMemo(
    () => build_group_palette_map(data.schema.models.map((m) => m.group)),
    [data.schema],
  )

  const colored_models = data.schema.models.map((m) => {
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
    <SchemaDiagram
      models={colored_models}
      relations={data.schema.relations}
      parserName={data.schema.parserName}
      savedLayout={data.layout}
    />
  )
}

export default function App() {
  const [data, set_data] = useState<DiagramData | null>(null)
  const [error, set_error] = useState<string | null>(null)

  const fetch_all = () => {
    Promise.all([
      fetch("/api/schema").then((r) => r.json() as Promise<SchemaData & { error?: string }>),
      fetch_layout(),
    ])
      .then(([schema, layout]) => {
        if (schema.error) {
          set_error(schema.error)
        } else {
          set_data({ schema, layout })
          set_error(null)
        }
      })
      .catch((e: unknown) => set_error(String(e)))
  }

  useEffect(() => {
    fetch_all()

    const es = new EventSource("/api/events")
    es.onmessage = (e) => {
      if (e.data === "reload") fetch_all()
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
