/**
 * Layered column-major layout on the FK graph:
 * - **Column 0** (leftmost) = BFS distance 0 from naming-heuristic roots.
 * - **Column 1, 2, …** = BFS distance +1 rightward.
 * - **Within each column**: models grouped by name-family (first word, de-pluralised),
 *   families ordered by max inbound-FK count descending; infra families (cache, session …) last.
 * - **Same-family models** across columns share the same Y band.
 */

export type RelationEdge = {
  fromModel: string
  toModel: string
}

/** Model shape required for sizing cards (same as Diagram). */
export type LayoutModelLite = {
  name: string
  fields: { length: number }
}

export type GridLayoutDims = {
  header_h: number
  field_h: number
  card_w: number
  col_gap: number
  row_gap: number
  padding: number
}

export const DEFAULT_RELATION_LAYOUT_DIMS: GridLayoutDims = {
  header_h: 44,
  field_h: 30,
  card_w: 264,
  col_gap: 100,
  row_gap: 50,
  padding: 40,
}

function merge_dims(dims?: Partial<GridLayoutDims>): GridLayoutDims {
  return { ...DEFAULT_RELATION_LAYOUT_DIMS, ...dims }
}

function card_height(model: LayoutModelLite, d: GridLayoutDims): number {
  return d.header_h + model.fields.length * d.field_h + d.row_gap
}

/** `full` starts with `prefix` and the next char is uppercase — avoids `Organization` → `Order`. */
function starts_with_pascal_prefix(full: string, prefix: string): boolean {
  if (prefix.length === 0 || full.length <= prefix.length) return false
  if (!full.startsWith(prefix)) return false
  const next = full[prefix.length]
  return next >= "A" && next <= "Z"
}

/**
 * Extract the first semantic word from a model name, then de-pluralise.
 *   CourseDetail → "course"   Courses → "course"   course_detail → "course"
 *   BlogInfo → "blog"         Blogs → "blog"        Categories → "category"
 *   CacheEntry → "cache"      SessionToken → "session"
 */
function extract_name_family(name: string): string {
  let first: string
  if (name.includes("_") || name.includes("-") || name.includes(".")) {
    first = name.split(/[_\-.]/)[0]
  } else {
    const m = name.match(/^[A-Z][a-z]+/)
    first = m ? m[0] : name
  }
  const w = first.toLowerCase()
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y"
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1)
  return w
}

const INFRA_FAMILIES = new Set([
  "cache", "session", "log", "audit", "temp", "queue",
  "job", "token", "migration", "webhook", "event",
])

function is_infrastructure_family(family: string): boolean {
  return INFRA_FAMILIES.has(family)
}

function build_adjacency(names: ReadonlySet<string>, relations: readonly RelationEdge[]): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>()
  for (const n of names) g.set(n, new Set())
  for (const r of relations) {
    const a = r.fromModel, b = r.toModel
    if (!names.has(a) || !names.has(b) || a === b) continue
    g.get(a)!.add(b)
    g.get(b)!.add(a)
  }
  return g
}

function connected_components(names: ReadonlySet<string>, adj: Map<string, Set<string>>): Set<string>[] {
  const unseen = new Set(names)
  const comps: Set<string>[] = []
  while (unseen.size) {
    let start = ""
    for (const n of unseen) if (start === "" || n.localeCompare(start) < 0) start = n
    unseen.delete(start)
    const comp = new Set<string>([start])
    const stack = [start]
    while (stack.length) {
      const v = stack.pop()!
      for (const w of adj.get(v)!) {
        if (unseen.has(w)) { unseen.delete(w); comp.add(w); stack.push(w) }
      }
    }
    comps.push(comp)
  }
  return comps
}

/** Shortest undirected BFS distance from any source within the component. */
function bfs_distances(
  comp: ReadonlySet<string>,
  adj: Map<string, Set<string>>,
  sources: readonly string[],
): Map<string, number> {
  const dist = new Map<string, number>()
  const q: string[] = []
  for (const s of sources) {
    if (!comp.has(s) || dist.has(s)) continue
    dist.set(s, 0)
    q.push(s)
  }
  let qi = 0
  while (qi < q.length) {
    const v = q[qi++]!
    const dv = dist.get(v)!
    for (const w of adj.get(v)!) {
      if (!comp.has(w)) continue
      const nw = dv + 1
      if (!dist.has(w) || nw < dist.get(w)!) { dist.set(w, nw); q.push(w) }
    }
  }
  return dist
}

function inbound_foreign_count(model_name: string, relations: readonly RelationEdge[]): number {
  let n = 0
  for (const r of relations) if (r.toModel === model_name) n++
  return n
}

/**
 * Names without `_` that are not Pascal-extensions of another such name become BFS roots
 * (column 0) when present in a component.
 */
function derive_root_names(names_without_underscore: readonly string[]): Set<string> {
  const sorted = [...names_without_underscore].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a.localeCompare(b),
  )
  const roots = new Set<string>()
  for (const nm of sorted) {
    let best_len = -1
    for (const r of roots) {
      if (starts_with_pascal_prefix(nm, r) && r.length > best_len) best_len = r.length
    }
    if (best_len === -1) roots.add(nm)
  }
  return roots
}

function pick_synthetic_root(comp: ReadonlySet<string>, relations: readonly RelationEdge[]): string {
  let best = "", best_in = -1
  for (const n of comp) {
    const k = inbound_foreign_count(n, relations)
    if (k > best_in || (k === best_in && (best === "" || n.localeCompare(best) < 0))) {
      best_in = k; best = n
    }
  }
  return best
}

export type RelationAwareLayoutResult = {
  positions: Record<string, { x: number; y: number }>
  canvasW: number
  canvasH: number
}

export function compute_relation_aware_positions(
  models: readonly LayoutModelLite[],
  relations: readonly RelationEdge[],
  dims?: Partial<GridLayoutDims>,
): RelationAwareLayoutResult {
  const d = merge_dims(dims)
  const model_map = new Map(models.map((m) => [m.name, m]))
  const all_names = models.map((m) => m.name)
  const names = new Set(all_names)

  if (names.size === 0) return { positions: {}, canvasW: d.padding * 2, canvasH: d.padding * 2 }

  const adj = build_adjacency(names, relations)
  const comps = connected_components(names, adj)

  // BFS layer assignment — layer N becomes column N (x-axis)
  const layers = new Map<string, number>()
  for (const comp of comps) {
    const no_underscore = [...comp].filter((n) => !n.includes("_"))
    const roots = [...derive_root_names(no_underscore)].filter((n) => comp.has(n))
    const sources = roots.length > 0 ? roots : [pick_synthetic_root(comp, relations)]
    const dist = bfs_distances(comp, adj, sources)
    for (const n of comp) layers.set(n, dist.get(n) ?? 0)
  }

  let max_layer = 0
  for (const L of layers.values()) max_layer = Math.max(max_layer, L)

  const by_layer = new Map<number, string[]>()
  for (const n of all_names) {
    const L = layers.get(n) ?? 0
    const arr = by_layer.get(L)
    if (arr) arr.push(n)
    else by_layer.set(L, [n])
  }

  // Derive name-family for every model
  const family_of = new Map(all_names.map((n) => [n, extract_name_family(n)]))

  // Family ordering: most inbound FKs first, infra families last, then alphabetical
  const family_inbound = new Map<string, number>()
  for (const n of all_names) {
    const fam = family_of.get(n)!
    const count = inbound_foreign_count(n, relations)
    family_inbound.set(fam, Math.max(family_inbound.get(fam) ?? 0, count))
  }

  const all_families = [...new Set(all_names.map((n) => family_of.get(n)!))]
  all_families.sort((a, b) => {
    const ia = is_infrastructure_family(a) ? 1 : 0
    const ib = is_infrastructure_family(b) ? 1 : 0
    if (ia !== ib) return ia - ib
    const fa = family_inbound.get(a) ?? 0
    const fb = family_inbound.get(b) ?? 0
    if (fb !== fa) return fb - fa
    return a.localeCompare(b)
  })
  const family_rank = new Map(all_families.map((f, i) => [f, i]))

  // Sort models within each column: by family rank, then inbound FK desc, then name
  const col_models = new Map<number, string[]>()
  for (let L = 0; L <= max_layer; L++) {
    const col = (by_layer.get(L) ?? []).sort((a, b) => {
      const ra = family_rank.get(family_of.get(a)!)!
      const rb = family_rank.get(family_of.get(b)!)!
      if (ra !== rb) return ra - rb
      const ia = inbound_foreign_count(a, relations)
      const ib = inbound_foreign_count(b, relations)
      if (ib !== ia) return ib - ia
      return a.localeCompare(b)
    })
    col_models.set(L, col)
  }

  // Max pixel height for each family's slot (across all columns)
  const family_slot_h = new Map<string, number>()
  for (let L = 0; L <= max_layer; L++) {
    const col_h = new Map<string, number>()
    for (const n of col_models.get(L) ?? []) {
      const fam = family_of.get(n)!
      col_h.set(fam, (col_h.get(fam) ?? 0) + card_height(model_map.get(n)!, d))
    }
    for (const [fam, h] of col_h) {
      family_slot_h.set(fam, Math.max(family_slot_h.get(fam) ?? 0, h))
    }
  }

  // Assign Y slot starts: families stacked top-to-bottom, extra row_gap between families
  const family_y_start = new Map<string, number>()
  let slot_cursor = d.padding
  for (const fam of all_families) {
    const h = family_slot_h.get(fam)
    if (h === undefined) continue
    family_y_start.set(fam, slot_cursor)
    slot_cursor += h + d.row_gap
  }

  // Place each model
  const positions: Record<string, { x: number; y: number }> = {}
  for (let L = 0; L <= max_layer; L++) {
    const x = d.padding + L * (d.card_w + d.col_gap)
    const fam_cursor = new Map<string, number>()
    for (const n of col_models.get(L) ?? []) {
      const fam = family_of.get(n)!
      const y = fam_cursor.get(fam) ?? family_y_start.get(fam) ?? d.padding
      positions[n] = { x, y }
      fam_cursor.set(fam, y + card_height(model_map.get(n)!, d))
    }
  }

  let max_r = d.padding, max_b = d.padding
  for (const m of models) {
    const p = positions[m.name]
    if (!p) continue
    max_r = Math.max(max_r, p.x + d.card_w)
    max_b = Math.max(max_b, p.y + card_height(m, d))
  }

  return { positions, canvasW: max_r + d.padding, canvasH: max_b + d.padding }
}
