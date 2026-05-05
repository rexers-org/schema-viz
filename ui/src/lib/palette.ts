/** Header Tailwind class + matching stroke for relation lines (Tailwind 700 hex). */
export const GROUP_PALETTE = [
  { header: "bg-blue-700", stroke: "#1d4ed8" },
  { header: "bg-violet-700", stroke: "#6d28d9" },
  { header: "bg-amber-700", stroke: "#b45309" },
  { header: "bg-emerald-700", stroke: "#047857" },
  { header: "bg-rose-700", stroke: "#be123c" },
  { header: "bg-teal-700", stroke: "#0f766e" },
  { header: "bg-indigo-700", stroke: "#4338ca" },
  { header: "bg-fuchsia-700", stroke: "#a21caf" },
  { header: "bg-lime-700", stroke: "#4d7c0f" },
  { header: "bg-sky-700", stroke: "#0369a1" },
  { header: "bg-slate-600", stroke: "#475569" },
  { header: "bg-orange-700", stroke: "#c2410c" },
  { header: "bg-cyan-700", stroke: "#0e7490" },
] as const

/** Stable palette slot per `group`: sort unique keys so different groups skew to different hues when count ≤ palette size. */
export function build_group_palette_map(groups: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(groups)].sort((a, b) => a.localeCompare(b))
  const m = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    m.set(sorted[i], i % GROUP_PALETTE.length)
  }
  return m
}

export function group_palette_index(group: string): number {
  return build_group_palette_map([group]).get(group) ?? 0
}
