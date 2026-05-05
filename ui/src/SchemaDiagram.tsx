import { clsx } from "clsx"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { GROUP_PALETTE } from "./lib/palette"
import { compute_relation_aware_positions } from "./lib/layout"
import type { Model, Relation } from "./types"
import {
  clear_table_layout_cookie,
  load_table_layout_cookie,
  save_table_layout_cookie,
  schema_drag_key,
  type TablePositionsMap,
} from "./lib/table-positions"
import {
  clear_viewport_cookie,
  load_viewport_cookie,
  save_viewport_cookie,
} from "./lib/viewport"

export type ColoredModel = Model & {
  headerColor: string
  relationStroke: string
  relationColorIndex: number
}

type Props = {
  models: ColoredModel[]
  relations: Relation[]
  parserName: string
}

const HEADER_H = 44
const FIELD_H = 30
const CARD_W = 264

const DEFAULT_VIEW_TRANSFORM = { x: 40, y: 40, zoom: 0.9 }
const VIEWPORT_SAVE_DEBOUNCE_MS = 280
const CARD_DRAG_PAD = 48

type LinePath = { d: string; id: string; stroke: string; marker_index: number }

function model_card_height(model: { fields: { length: number } }): number {
  return HEADER_H + model.fields.length * FIELD_H
}

function bounds_from_positions(models: ColoredModel[], layout: Record<string, { x: number; y: number }>): { w: number; h: number } {
  let max_r = CARD_DRAG_PAD
  let max_b = CARD_DRAG_PAD
  for (const m of models) {
    const p = layout[m.name]
    if (!p) continue
    const card_h = model_card_height(m)
    max_r = Math.max(max_r, p.x + CARD_W + CARD_DRAG_PAD)
    max_b = Math.max(max_b, p.y + card_h + CARD_DRAG_PAD)
  }
  return { w: max_r, h: max_b }
}

function merged_positions(
  models: ColoredModel[],
  base_defaults: Record<string, { x: number; y: number }>,
  overrides: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  for (const m of models) {
    const b = base_defaults[m.name]
    if (!b) continue
    const o = overrides[m.name]
    out[m.name] = o ?? b
  }
  return out
}

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

    const line_id = `${rel.fromModel}.${rel.fromField}->${rel.toModel}.${rel.toField}`
    lines.push({
      d,
      id: line_id,
      stroke: from_model.relationStroke,
      marker_index: from_model.relationColorIndex,
    })
  }

  return lines
}

export default function SchemaDiagram({ models, relations, parserName }: Props) {
  const wrapper_ref = useRef<HTMLDivElement>(null)
  const last_pos = useRef({ x: 0, y: 0 })
  const transform_ref = useRef(DEFAULT_VIEW_TRANSFORM)
  const parser_name_ref = useRef(parserName)
  parser_name_ref.current = parserName

  const skip_next_viewport_persist = useRef(true)

  const [transform, set_transform] = useState(() =>
    typeof document !== "undefined"
      ? load_viewport_cookie(parserName) ?? DEFAULT_VIEW_TRANSFORM
      : DEFAULT_VIEW_TRANSFORM,
  )

  transform_ref.current = transform

  const prev_parser_ref = useRef<string | null>(null)
  const skip_next_layout_persist = useRef(true)

  useEffect(() => {
    if (skip_next_viewport_persist.current) {
      skip_next_viewport_persist.current = false
      return
    }

    const id = window.setTimeout(() => {
      save_viewport_cookie({ ...transform, parserName: parser_name_ref.current })
    }, VIEWPORT_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(id)
  }, [transform])

  useEffect(() => {
    const flush_viewport = () => {
      save_viewport_cookie({ ...transform_ref.current, parserName: parser_name_ref.current })
    }

    const flush_tables = () => {
      const pmap = position_overrides_ref.current
      const pn = parser_name_ref.current
      const sig = layout_sig_ref.current
      if (Object.keys(pmap).length === 0) clear_table_layout_cookie()
      else save_table_layout_cookie(pn, pmap, sig)
    }

    window.addEventListener("pagehide", flush_viewport)
    window.addEventListener("pagehide", flush_tables)

    const on_visibility = () => {
      if (document.visibilityState === "hidden") {
        flush_viewport()
        flush_tables()
      }
    }
    document.addEventListener("visibilitychange", on_visibility)

    return () => {
      window.removeEventListener("pagehide", flush_viewport)
      window.removeEventListener("pagehide", flush_tables)
      document.removeEventListener("visibilitychange", on_visibility)
      flush_viewport()
      flush_tables()
    }
  }, [])

  const drag_signature = schema_drag_key(models, relations)
  const relation_layout = useMemo(() => compute_relation_aware_positions(models, relations), [drag_signature])

  const positions_ref = useRef(relation_layout.positions)
  positions_ref.current = relation_layout.positions

  const layout_sig_ref = useRef(drag_signature)
  layout_sig_ref.current = drag_signature

  const [position_overrides, set_position_overrides] = useState<TablePositionsMap>(() => {
    if (typeof document === "undefined") return {}
    const names = new Set(models.map((m) => m.name))
    return load_table_layout_cookie(parserName, names, schema_drag_key(models, relations))
  })

  const position_overrides_ref = useRef(position_overrides)
  position_overrides_ref.current = position_overrides

  useEffect(() => {
    if (prev_parser_ref.current === null) {
      prev_parser_ref.current = parserName
      return
    }
    if (prev_parser_ref.current !== parserName) {
      prev_parser_ref.current = parserName
      set_transform(load_viewport_cookie(parserName) ?? DEFAULT_VIEW_TRANSFORM)
      skip_next_viewport_persist.current = true
      const names = new Set(models.map((m) => m.name))
      set_position_overrides(load_table_layout_cookie(parserName, names, schema_drag_key(models, relations)))
      skip_next_layout_persist.current = true
    }
  }, [parserName])

  useEffect(() => {
    if (skip_next_layout_persist.current) {
      skip_next_layout_persist.current = false
      return
    }

    const id = window.setTimeout(() => {
      const pmap = position_overrides_ref.current
      const pname = parser_name_ref.current
      const dk = layout_sig_ref.current
      if (Object.keys(pmap).length === 0) clear_table_layout_cookie()
      else save_table_layout_cookie(pname, pmap, dk)
    }, VIEWPORT_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(id)
  }, [position_overrides])

  useEffect(() => {
    const defs = relation_layout.positions
    set_position_overrides((prev) => {
      const next = { ...prev }
      let changed = false
      for (const k of Object.keys(next)) {
        if (!(k in defs)) {
          delete next[k]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [relation_layout])

  const layout_positions = useMemo(
    () => merged_positions(models, relation_layout.positions, position_overrides),
    [models, relation_layout, position_overrides],
  )

  const bounds = useMemo(() => bounds_from_positions(models, layout_positions), [models, layout_positions])
  const canvas_w_eff = Math.max(relation_layout.canvasW, bounds.w)
  const canvas_h_eff = Math.max(relation_layout.canvasH, bounds.h)

  const drag_last_screen = useRef({ x: 0, y: 0 })
  const [dragging_model, set_dragging_model] = useState<string | null>(null)

  const lines = compute_lines(models, relations, layout_positions)

  // Ctrl+scroll → zoom (incl. trackpad pinch). Otherwise pan with deltaX / deltaY
  // (two-finger horizontal swipe uses deltaX; vertical uses deltaY).
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
      return
    }

    const el = wrapper_ref.current
    const line_px = 18
    const page_h = el?.clientHeight ?? 640
    const scale =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE ? line_px : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? page_h : 1

    let dx = e.deltaX * scale
    let dy = e.deltaY * scale

    // Mouse / legacy: Shift + vertical wheel → pan horizontally (no deltaX).
    if (e.shiftKey && dx === 0 && dy !== 0) {
      dx = dy
      dy = 0
    }

    if (dx === 0 && dy === 0) return

    set_transform((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }))
  }, [])

  useEffect(() => {
    const el = wrapper_ref.current
    if (!el) return
    el.addEventListener("wheel", on_wheel, { passive: false })
    return () => el.removeEventListener("wheel", on_wheel)
  }, [on_wheel])

  // Canvas pan — ignore starts on model cards (they handle their own drag)
  const on_pointer_down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("[data-model-card]")) return
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

  const on_card_pointer_down = useCallback((model_name: string) => {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      set_dragging_model(model_name)
      drag_last_screen.current = { x: e.clientX, y: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }, [])

  const on_card_pointer_move = useCallback((model_name: string) => {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return

      const z = transform_ref.current.zoom
      const dx = (e.clientX - drag_last_screen.current.x) / z
      const dy = (e.clientY - drag_last_screen.current.y) / z
      drag_last_screen.current = { x: e.clientX, y: e.clientY }

      const base_positions = positions_ref.current
      set_position_overrides((prev) => {
        const prev_pt = prev[model_name] ?? base_positions[model_name]
        if (!prev_pt) return prev
        return {
          ...prev,
          [model_name]: { x: prev_pt.x + dx, y: prev_pt.y + dy },
        }
      })
    }
  }, [])

  const on_card_pointer_up = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    set_dragging_model(null)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] shrink-0 cursor-default select-none">
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
            onClick={() => {
              clear_viewport_cookie()
              clear_table_layout_cookie()
              // Clear drag overrides → layout matches `defaultPositions` (relation-aware pre-layout).
              set_position_overrides({})
              set_transform(DEFAULT_VIEW_TRANSFORM)
              skip_next_layout_persist.current = true
              skip_next_viewport_persist.current = true
            }}
            className="text-[11px] text-gray-600 hover:text-gray-300 transition-colors cursor-pointer"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="absolute flex gap-1 bottom-4 left-5 text-[10px] text-gray-700 pointer-events-none z-10">
        <p className="text-white/50">Schema Viz</p>
        <p>by Rexers.research</p>
      </div>

      <div className="absolute bottom-4 right-5 text-[10px] text-gray-700 pointer-events-none z-10 text-right leading-relaxed">
        <span className="text-gray-600">Ctrl</span> + scroll · Drag canvas / drag tables
      </div>

      {/* Viewport */}
      <div
        ref={wrapper_ref}
        className="flex-1 overflow-hidden overscroll-contain cursor-grab active:cursor-grabbing"
        onPointerDown={on_pointer_down}
        onPointerMove={on_pointer_move}
        onPointerUp={on_pointer_up}
      >
        <div
          className="cursor-grab"
          style={{
            transformOrigin: "0 0",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
            width: canvas_w_eff,
            height: canvas_h_eff,
            position: "relative",
            willChange: "transform",
          }}
        >
          {/* SVG connection lines */}
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            width={canvas_w_eff}
            height={canvas_h_eff}
          >
            <defs>
              {GROUP_PALETTE.map((pal, i) => (
                <marker
                  key={pal.stroke}
                  id={`schema-viz-arrow-${i}`}
                  markerWidth="7"
                  markerHeight="5"
                  refX="6"
                  refY="2.5"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <polygon points="0 0, 7 2.5, 0 5" fill={pal.stroke} />
                </marker>
              ))}
            </defs>
            {lines.map((line) => (
              <path
                key={line.id}
                d={line.d}
                stroke={line.stroke}
                strokeWidth={1.5}
                fill="none"
                markerEnd={`url(#schema-viz-arrow-${line.marker_index})`}
              />
            ))}
          </svg>

          {/* Model cards */}
          {models.map((model) => {
            const pos = layout_positions[model.name]
            if (!pos) return null
            const is_dragging = dragging_model === model.name
            return (
              <div
                key={model.name}
                data-model-card
                className={clsx(
                  "absolute rounded-lg overflow-hidden shadow-2xl border border-white/[0.07] touch-none select-none",
                  is_dragging ? "cursor-grabbing" : "cursor-move",
                  is_dragging && "z-[100] shadow-black/80 ring-2 ring-white/25",
                )}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: CARD_W,
                  zIndex: is_dragging ? 100 : 1,
                }}
                onPointerDown={on_card_pointer_down(model.name)}
                onPointerMove={on_card_pointer_move(model.name)}
                onPointerUp={on_card_pointer_up}
                onPointerCancel={on_card_pointer_up}
              >
                <div
                  className={clsx(
                    "px-3 flex flex-col justify-center border-b border-black/30",
                    is_dragging ? "cursor-grabbing" : "cursor-move",
                    model.headerColor,
                  )}
                  style={{ height: HEADER_H }}
                  title="Drag to move table"
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
                        is_dragging ? "cursor-grabbing" : "cursor-move",
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
      type="button"
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/8 rounded transition-colors text-base leading-none cursor-pointer"
    >
      {children}
    </button>
  )
}
