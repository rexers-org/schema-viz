import { clsx } from "clsx"
import React, { useCallback, useEffect, useRef, useState } from "react"

import type { Model, Relation } from "./types"

export type ColoredModel = Model & { headerColor: string }

type Props = {
  models: ColoredModel[]
  relations: Relation[]
  positions: Record<string, { x: number; y: number }>
  canvasW: number
  canvasH: number
  parserName: string
}

const HEADER_H = 44
const FIELD_H = 30
const CARD_W = 264

type LinePath = { d: string; id: string }

function compute_lines(
  models: ColoredModel[],
  relations: Relation[],
  positions: Record<string, { x: number; y: number }>,
): LinePath[] {
  const model_map = new Map(models.map((m) => [m.name, m]))
  const lines: LinePath[] = []

  for (const rel of relations) {
    const from_model = model_map.get(rel.fromModel)
    const to_model = model_map.get(rel.toModel)
    if (!from_model || !to_model) continue

    const from_idx = from_model.fields.findIndex((f) => f.name === rel.fromField)
    const to_idx = to_model.fields.findIndex((f) => f.name === rel.toField)
    if (from_idx === -1 || to_idx === -1) continue

    const fp = positions[rel.fromModel]
    const tp = positions[rel.toModel]
    if (!fp || !tp) continue

    const fy = fp.y + HEADER_H + from_idx * FIELD_H + FIELD_H / 2
    const ty = tp.y + HEADER_H + to_idx * FIELD_H + FIELD_H / 2
    const fR = fp.x + CARD_W
    const fL = fp.x
    const tR = tp.x + CARD_W
    const tL = tp.x

    let d: string

    if (fR + 10 < tL) {
      const dx = (tL - fR) * 0.5
      d = `M ${fR} ${fy} C ${fR + dx} ${fy} ${tL - dx} ${ty} ${tL} ${ty}`
    } else if (tR + 10 < fL) {
      const dx = (fL - tR) * 0.5
      d = `M ${fL} ${fy} C ${fL - dx} ${fy} ${tR + dx} ${ty} ${tR} ${ty}`
    } else {
      // Same column — hook outward
      const is_first_col = fL <= 50
      if (is_first_col) {
        const hook = Math.min(fL, tL) - 50
        d = `M ${fL} ${fy} C ${hook} ${fy} ${hook} ${ty} ${tL} ${ty}`
      } else {
        const hook = Math.max(fR, tR) + 50
        d = `M ${fR} ${fy} C ${hook} ${fy} ${hook} ${ty} ${tR} ${ty}`
      }
    }

    lines.push({ d, id: `${rel.fromModel}.${rel.fromField}->${rel.toModel}.${rel.toField}` })
  }

  return lines
}

export default function SchemaDiagram({ models, relations, positions, canvasW, canvasH, parserName }: Props) {
  const wrapper_ref = useRef<HTMLDivElement>(null)
  const last_pos = useRef({ x: 0, y: 0 })
  const [transform, set_transform] = useState({ x: 40, y: 40, zoom: 0.9 })

  const lines = compute_lines(models, relations, positions)

  // Ctrl+scroll → zoom, Shift+scroll → pan X, plain scroll → pan Y
  const on_wheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey) {
      const rect = wrapper_ref.current!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      set_transform((prev) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const new_zoom = Math.max(0.1, Math.min(4, prev.zoom * factor))
        const scale = new_zoom / prev.zoom
        return { zoom: new_zoom, x: mx - scale * (mx - prev.x), y: my - scale * (my - prev.y) }
      })
    } else if (e.shiftKey) {
      set_transform((prev) => ({ ...prev, x: prev.x - e.deltaY }))
    } else {
      set_transform((prev) => ({ ...prev, y: prev.y - e.deltaY }))
    }
  }, [])

  useEffect(() => {
    const el = wrapper_ref.current
    if (!el) return
    el.addEventListener("wheel", on_wheel, { passive: false })
    return () => el.removeEventListener("wheel", on_wheel)
  }, [on_wheel])

  // Pointer capture — drag stays active even when cursor leaves the viewport
  const on_pointer_down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    last_pos.current = { x: e.clientX, y: e.clientY }
  }

  const on_pointer_move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - last_pos.current.x
    const dy = e.clientY - last_pos.current.y
    last_pos.current = { x: e.clientX, y: e.clientY }
    set_transform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }

  const on_pointer_up = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const zoom_by = (factor: number) =>
    set_transform((p) => ({ ...p, zoom: Math.max(0.1, Math.min(4, p.zoom * factor)) }))

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white text-sm font-semibold">Schema Viz</span>
          <span className="text-gray-600 text-[11px] bg-white/5 px-2 py-0.5 rounded-full">{parserName}</span>
          <span className="text-gray-600 text-xs">
            {models.length} models · {relations.length} relations
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <LegendBadge label="PK" color="text-amber-400 bg-amber-950/70" />
            <LegendBadge label="FK" color="text-sky-400 bg-sky-950/70" />
            <LegendBadge label="UQ" color="text-purple-400 bg-purple-950/70" />
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Zoom buttons */}
          <div className="flex items-center gap-0.5">
            <ZoomBtn onClick={() => zoom_by(1 / 1.2)}>−</ZoomBtn>
            <span className="text-gray-500 text-[11px] font-mono w-11 text-center tabular-nums">
              {Math.round(transform.zoom * 100)}%
            </span>
            <ZoomBtn onClick={() => zoom_by(1.2)}>+</ZoomBtn>
          </div>

          <button
            onClick={() => set_transform({ x: 40, y: 40, zoom: 0.9 })}
            className="text-[11px] text-gray-600 hover:text-gray-300 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="absolute bottom-4 left-5 text-[10px] text-gray-700 pointer-events-none z-10">
        by Rexers.research
      </div>

      <div className="absolute bottom-4 right-5 text-[10px] text-gray-700 pointer-events-none z-10 text-right leading-relaxed">
        <span className="text-gray-600">Ctrl</span> + scroll to zoom · Drag to pan
      </div>

      {/* Viewport */}
      <div
        ref={wrapper_ref}
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onPointerDown={on_pointer_down}
        onPointerMove={on_pointer_move}
        onPointerUp={on_pointer_up}
      >
        <div
          style={{
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
            width: canvasW,
            height: canvasH,
            position: "relative",
            willChange: "transform",
          }}
        >
          {/* SVG connection lines */}
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            width={canvasW}
            height={canvasH}
          >
            <defs>
              <marker id="arrow" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill="#4B5563" />
              </marker>
            </defs>
            {lines.map((line) => (
              <path key={line.id} d={line.d} stroke="#374151" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
            ))}
          </svg>

          {/* Model cards */}
          {models.map((model) => {
            const pos = positions[model.name]
            if (!pos) return null
            return (
              <div
                key={model.name}
                className="absolute rounded-lg overflow-hidden shadow-2xl border border-white/[0.07]"
                style={{ left: pos.x, top: pos.y, width: CARD_W }}
              >
                <div
                  className={clsx(
                    "px-3 flex flex-col justify-center border-b border-black/30",
                    model.headerColor,
                  )}
                  style={{ height: HEADER_H }}
                >
                  <div className="text-white text-[13px] font-semibold leading-tight">{model.name}</div>
                  <div className="text-white/50 text-[10px] font-mono leading-tight">{model.tableName}</div>
                </div>

                <div className="bg-[#161b22]">
                  {model.fields.map((field) => (
                    <div
                      key={field.name}
                      className={clsx(
                        "flex items-center justify-between px-2.5 border-b border-white/[0.04]",
                        field.isPK && "bg-amber-950/25",
                        field.isFK && !field.isPK && "bg-sky-950/25",
                      )}
                      style={{ height: FIELD_H }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {field.isPK && <Badge color="text-amber-400 bg-amber-950/70">PK</Badge>}
                        {field.isFK && !field.isPK && <Badge color="text-sky-400 bg-sky-950/70">FK</Badge>}
                        {field.isUnique && !field.isPK && <Badge color="text-purple-400 bg-purple-950/70">UQ</Badge>}
                        <span
                          className={clsx(
                            "font-mono text-[11px] truncate",
                            field.isPK ? "text-amber-300" : field.isFK ? "text-sky-300" : "text-gray-300",
                          )}
                        >
                          {field.name}
                        </span>
                        {field.isOptional && <span className="text-gray-600 shrink-0 text-[11px]">?</span>}
                      </div>
                      <span className="font-mono text-gray-500 shrink-0 ml-2 text-[10px]">{field.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Badge({ color, children }: { color: string; children: string }) {
  return (
    <span className={clsx("shrink-0 text-[9px] font-bold px-1 rounded-sm leading-[14px]", color)}>{children}</span>
  )
}

function LegendBadge({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge color={color}>{label}</Badge>
      <span>{label === "PK" ? "Primary key" : label === "FK" ? "Foreign key" : "Unique"}</span>
    </div>
  )
}

function ZoomBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/8 rounded transition-colors text-base leading-none"
    >
      {children}
    </button>
  )
}
