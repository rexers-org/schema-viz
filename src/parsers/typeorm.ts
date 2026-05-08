import path from "path"
import { readFileSync } from "fs"

import { collect_files_recursive } from "@/lib/discovery"

import type { Field, Model, Relation, SchemaData } from "@/types"
import type { Parser, ParserId } from "./index"

function to_snake_case(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

function ts_type_to_db_type(ts_type: string): string {
  const clean = ts_type.replace(/\[\]/g, "").replace(/[?]/g, "").replace(/\s*\|.*$/, "").trim()
  switch (clean) {
    case "number":
      return "int"
    case "string":
      return "varchar"
    case "boolean":
      return "boolean"
    case "Date":
      return "timestamp"
    case "bigint":
      return "bigint"
    default:
      return clean || "varchar"
  }
}

function extract_decorator_args(src: string, after_open_paren: number): { args: string; end: number } {
  let depth = 1
  let i = after_open_paren
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    } else if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++
      i++
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++
        i++
      }
    }
    if (depth > 0) i++
  }
  return { args: src.slice(after_open_paren, i - 1), end: i }
}

type DecoratorInfo = { name: string; args: string }

type PropInfo = {
  prop_name: string
  ts_type: string
  decorators: DecoratorInfo[]
}

function parse_entity_source(src: string): Array<{
  class_name: string
  entity_args: string
  props: PropInfo[]
}> {
  const results: Array<{ class_name: string; entity_args: string; props: PropInfo[] }> = []
  let i = 0

  while (i < src.length) {
    // Skip line comments
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    // Skip block comments
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }

    // Look for @Entity
    if (src[i] === "@") {
      const decorator_match = /^@(\w+)/.exec(src.slice(i))
      if (decorator_match && decorator_match[1] === "Entity") {
        let entity_args = ""
        let j = i + decorator_match[0].length
        while (j < src.length && /\s/.test(src[j])) j++
        if (src[j] === "(") {
          const parsed = extract_decorator_args(src, j + 1)
          entity_args = parsed.args
          j = parsed.end
        }

        // Scan forward for class declaration
        const class_match = /\bclass\s+(\w+)/.exec(src.slice(j))
        if (!class_match) {
          i++
          continue
        }
        const class_name = class_match[1]
        let k = j + class_match.index + class_match[0].length

        // Skip to opening brace of class body
        while (k < src.length && src[k] !== "{") k++
        if (k >= src.length) break
        k++ // skip '{'

        const props = parse_class_body(src, k)
        results.push({ class_name, entity_args, props: props.props })
        i = props.end
        continue
      }
    }

    i++
  }

  return results
}

function parse_class_body(src: string, start: number): { props: PropInfo[]; end: number } {
  const props: PropInfo[] = []
  let i = start
  let class_depth = 1
  let pending_decorators: DecoratorInfo[] = []

  while (i < src.length && class_depth > 0) {
    // Line comments
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    // Block comments
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }

    if (src[i] === "{") {
      // Method body — skip it, resetting pending decorators since it's not a property
      class_depth++
      // If we're entering a nested block (method body), consume until matching }
      if (class_depth > 1) {
        let depth = 1
        i++
        while (i < src.length && depth > 0) {
          if (src[i] === "/" && src[i + 1] === "/") {
            while (i < src.length && src[i] !== "\n") i++
            continue
          }
          if (src[i] === "/" && src[i + 1] === "*") {
            i += 2
            while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++
            i += 2
            continue
          }
          if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
            const q = src[i]
            i++
            while (i < src.length && src[i] !== q) {
              if (src[i] === "\\") i++
              i++
            }
          } else if (src[i] === "{") {
            depth++
          } else if (src[i] === "}") {
            depth--
            if (depth === 0) {
              class_depth--
              pending_decorators = []
              break
            }
          }
          i++
        }
        i++
        continue
      }
      i++
      continue
    }

    if (src[i] === "}") {
      class_depth--
      i++
      continue
    }

    // Decorator
    if (src[i] === "@") {
      const dec_match = /^@(\w+)/.exec(src.slice(i))
      if (dec_match) {
        const dec_name = dec_match[1]
        let j = i + dec_match[0].length
        while (j < src.length && /[ \t]/.test(src[j])) j++
        let args = ""
        if (src[j] === "(") {
          const parsed = extract_decorator_args(src, j + 1)
          args = parsed.args.trim()
          j = parsed.end
        }
        pending_decorators.push({ name: dec_name, args })
        i = j
        continue
      }
    }

    // Property declaration: propName[!?]: Type
    const prop_match = /^(\w+)[!?]?\s*:\s*/.exec(src.slice(i))
    if (prop_match && pending_decorators.length > 0) {
      const prop_name = prop_match[1]
      let j = i + prop_match[0].length

      // Read the type — collect until ';' or newline at depth 0
      let type_buf = ""
      let angle_depth = 0
      let paren_depth = 0
      while (j < src.length) {
        const ch = src[j]
        if (ch === "<") angle_depth++
        else if (ch === ">") angle_depth--
        else if (ch === "(") paren_depth++
        else if (ch === ")") paren_depth--
        else if ((ch === ";" || ch === "\n") && angle_depth === 0 && paren_depth === 0) break
        type_buf += ch
        j++
      }

      const ts_type = type_buf.trim()
      props.push({ prop_name, ts_type, decorators: pending_decorators })
      pending_decorators = []
      i = j
      continue
    }

    // Skip whitespace and other characters
    if (/\s/.test(src[i])) {
      i++
      continue
    }

    // Non-decorator, non-property token — reset pending decorators only if it's a keyword
    // that indicates we missed a property or are at a method signature
    if (prop_match === null && pending_decorators.length > 0) {
      // Check if it could be a keyword that starts a method without a type annotation
      const word_match = /^\w+/.exec(src.slice(i))
      if (word_match) {
        const word = word_match[0]
        if (["constructor", "async", "public", "private", "protected", "static", "readonly", "abstract", "override", "get", "set"].includes(word)) {
          pending_decorators = []
        }
        i += word_match[0].length
        continue
      }
    }

    i++
  }

  return { props, end: i }
}

function extract_string_arg(args: string): string | undefined {
  const m = args.match(/^['"]([^'"]+)['"]/)
  return m ? m[1] : undefined
}

function extract_name_option(args: string): string | undefined {
  const m = args.match(/\bname\s*:\s*['"]([^'"]+)['"]/)
  return m ? m[1] : undefined
}

function extract_type_option(args: string): string | undefined {
  const m = args.match(/\btype\s*:\s*['"]([^'"]+)['"]/)
  return m ? m[1] : undefined
}

function extract_relation_target(args: string): string | undefined {
  const m = args.match(/\(\s*\)\s*=>\s*(\w+)/)
  return m ? m[1] : undefined
}

function parse_entity(params: {
  class_name: string
  entity_args: string
  props: PropInfo[]
  group: string
}): { model: Model; relations: Relation[] } {
  const { class_name, entity_args, props, group } = params

  const table_name =
    extract_string_arg(entity_args.trim()) ??
    extract_name_option(entity_args) ??
    to_snake_case(class_name)

  const fields: Field[] = []
  const relations: Relation[] = []
  const explicit_fk_cols = new Set<string>()

  // First pass: collect explicit @Column FK col names so we don't duplicate them
  for (const prop of props) {
    const has_column = prop.decorators.some((d) => d.name === "Column")
    const has_join = prop.decorators.some((d) => d.name === "JoinColumn")
    const has_many_to_one = prop.decorators.some((d) => d.name === "ManyToOne")
    const has_one_to_one = prop.decorators.some((d) => d.name === "OneToOne")

    if (has_column && !has_many_to_one && !has_one_to_one && !has_join) {
      // plain column — may be an explicit FK column declared alongside a relation property
      explicit_fk_cols.add(prop.prop_name)
    }
  }

  // Second pass: build fields and relations
  for (const prop of props) {
    const { prop_name, ts_type, decorators } = prop

    const dec_names = new Set(decorators.map((d) => d.name))
    const get_dec = (name: string) => decorators.find((d) => d.name === name)

    // Skip inverse side of relations (no @JoinColumn, no ownership)
    const has_one_to_many = dec_names.has("OneToMany")
    const has_many_to_many = dec_names.has("ManyToMany")
    if (has_one_to_many) continue
    if (has_many_to_many && !dec_names.has("JoinColumn") && !dec_names.has("JoinTable")) continue

    const has_many_to_one = dec_names.has("ManyToOne")
    const has_one_to_one = dec_names.has("OneToOne")
    const is_relation_owner =
      has_many_to_one || (has_one_to_one && dec_names.has("JoinColumn"))

    if (is_relation_owner) {
      const rel_dec = get_dec("ManyToOne") ?? get_dec("OneToOne")!
      const target_class = extract_relation_target(rel_dec.args)
      if (!target_class) continue

      const join_dec = get_dec("JoinColumn")
      const fk_col_name = join_dec
        ? (extract_name_option(join_dec.args) ?? `${prop_name}Id`)
        : `${prop_name}Id`

      // Add FK field only if not already declared as an explicit @Column
      if (!explicit_fk_cols.has(fk_col_name) && !explicit_fk_cols.has(prop_name)) {
        fields.push({
          name: fk_col_name,
          type: "int",
          isPK: false,
          isFK: true,
          isUnique: has_one_to_one,
          isOptional: ts_type.includes("| null") || ts_type.includes("| undefined"),
        })
      } else {
        // Mark the existing column as FK
        const existing = fields.find((f) => f.name === fk_col_name || f.name === prop_name)
        if (existing) existing.isFK = true
      }

      relations.push({
        fromModel: class_name,
        fromField: fk_col_name,
        toModel: target_class,
        toField: "id",
      })
      continue
    }

    // Column decorators
    const PRIMARY_GENERATED = ["PrimaryGeneratedColumn", "PrimaryColumn"]
    const DATE_COLS = ["CreateDateColumn", "UpdateDateColumn", "DeleteDateColumn"]

    if (dec_names.has("PrimaryGeneratedColumn")) {
      const dec = get_dec("PrimaryGeneratedColumn")!
      const first_arg = extract_string_arg(dec.args.trim())
      fields.push({
        name: prop_name,
        type: first_arg === "uuid" ? "uuid" : "int",
        isPK: true,
        isFK: false,
        isUnique: false,
        isOptional: false,
      })
      continue
    }

    if (dec_names.has("PrimaryColumn")) {
      const dec = get_dec("PrimaryColumn")!
      const col_type =
        extract_string_arg(dec.args.trim()) ??
        extract_type_option(dec.args) ??
        ts_type_to_db_type(ts_type)
      fields.push({
        name: prop_name,
        type: col_type,
        isPK: true,
        isFK: false,
        isUnique: false,
        isOptional: false,
      })
      continue
    }

    if (DATE_COLS.some((n) => dec_names.has(n))) {
      fields.push({
        name: prop_name,
        type: "timestamp",
        isPK: false,
        isFK: false,
        isUnique: false,
        isOptional: dec_names.has("DeleteDateColumn"),
      })
      continue
    }

    if (dec_names.has("VersionColumn")) {
      fields.push({
        name: prop_name,
        type: "int",
        isPK: false,
        isFK: false,
        isUnique: false,
        isOptional: false,
      })
      continue
    }

    if (dec_names.has("Column")) {
      const dec = get_dec("Column")!
      const args = dec.args.trim()

      const first_str = extract_string_arg(args)
      const type_opt = extract_type_option(args)
      const col_type = first_str ?? type_opt ?? ts_type_to_db_type(ts_type)

      const is_unique = /\bunique\s*:\s*true/.test(args)
      const is_nullable =
        /\bnullable\s*:\s*true/.test(args) ||
        ts_type.includes("| null") ||
        ts_type.includes("| undefined")

      const col_name_opt = extract_name_option(args)
      const col_name = col_name_opt ?? prop_name

      fields.push({
        name: col_name,
        type: col_type,
        isPK: false,
        isFK: false,
        isUnique: is_unique,
        isOptional: is_nullable,
      })
      continue
    }
  }

  // Third pass: mark explicit FK columns (declared as @Column alongside a relation)
  for (const prop of props) {
    const has_column = prop.decorators.some((d) => d.name === "Column")
    if (!has_column) continue

    // Check if another property is a relation owner that references this column
    const is_fk = relations.some((r) => r.fromField === prop.prop_name)
    if (is_fk) {
      const field = fields.find((f) => f.name === prop.prop_name)
      if (field) field.isFK = true
    }
  }

  return {
    model: { name: class_name, tableName: table_name, group, fields },
    relations,
  }
}

function parse_files(abs_paths: string[], project_root: string): SchemaData {
  const all_models: Model[] = []
  const all_relations: Relation[] = []
  const models_by_group: Record<string, Model[]> = {}

  for (const abs_path of abs_paths) {
    const group =
      path.relative(project_root, abs_path).replace(/\\/g, "/") || path.basename(abs_path)
    let src: string
    try {
      src = readFileSync(abs_path, "utf-8")
    } catch {
      continue
    }

    const entities = parse_entity_source(src)
    const file_models: Model[] = []

    for (const entity of entities) {
      const { model, relations } = parse_entity({
        class_name: entity.class_name,
        entity_args: entity.entity_args,
        props: entity.props,
        group,
      })
      all_models.push(model)
      all_relations.push(...relations)
      file_models.push(model)
    }

    if (file_models.length > 0) {
      models_by_group[group] = file_models
    }
  }

  return {
    models: all_models,
    relations: all_relations,
    modelsByGroup: models_by_group,
    parserName: "typeorm",
  }
}

function discover_files(project_root: string): string[] {
  return collect_files_recursive({
    project_root,
    basename_match: (name) =>
      name.endsWith(".entity.ts") || name.endsWith(".entity.js"),
  })
}

function matches_single_file(abs_path: string): boolean {
  const base = path.basename(abs_path)
  return base.endsWith(".entity.ts") || base.endsWith(".entity.js")
}

export const typeormParser: Parser = {
  id: "typeorm",
  name: "TypeORM",
  file_requirement_hint: "Expected a TypeORM entity file named *.entity.ts or *.entity.js",
  discover_files,
  matches_single_file,
  parse_files,
}
