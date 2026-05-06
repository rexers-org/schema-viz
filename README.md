# Schema Viz

> Universal database schema visualizer — point it at a schema file or directory and get an interactive ER diagram in your browser, with pan, zoom, and live reload.

**Supported formats:** Prisma · Laravel migrations · JSON · PostgreSQL / MySQL (live URL)

---

## Release Note

- `0.3.0` — table selection: click any table to highlight it and its FK relations; unrelated tables dim out. Framework logos in toolbar (Prisma, Laravel, PostgreSQL, MySQL, JSON). Server-side layout persistence with `--share` flag.
- `0.2.1` — documentation update (README and publishing-related docs alignment).
- `0.2.0` — added live database introspection for PostgreSQL/MySQL, parser filter support (`--parser`), and browser auto-open toggle (`--autoopen` / `--auto-open`).

---

## Features

- **Smart auto-layout** — tables are arranged column-by-column using FK-graph BFS. The most-referenced tables land in the leftmost column; related tables (e.g. `Course` / `Courses` / `CourseDetail`) are grouped in the same horizontal band; infrastructure tables (cache, session, log …) are pushed to the bottom.
- **Table selection** — click any table to highlight it. Directly related tables (FK in or out) stay visible; all others dim out. FK lines animate with a directional flow to show the relationship direction. Click the same table or the canvas background to deselect.
- **Drag & persist** — drag tables to rearrange; positions and viewport are saved server-side and survive browser restarts. See [Layout persistence](#layout-persistence).
- **Framework logos** — the toolbar shows the detected framework logo (Prisma, Laravel, PostgreSQL, MySQL, JSON) instead of a plain text badge.
- **Live reload** — file-system changes trigger an instant diagram refresh via SSE.
- **Pan, zoom** — full canvas navigation; **Reset view** restores pan and zoom without touching table positions.
- **Database introspection** — connect directly with a PostgreSQL or MySQL URL; no files needed.

---

## Installation

```bash
npm install -g schema-viz
```

---

## Usage

```bash
schema-viz <path> [options]
schema-viz --url '<connection-string>' [options]
```

| Option | Default | Description |
|---|---|---|
| `--url` | — | `postgresql://` / `postgres://` / `mysql://` connection string (instead of `<path>`) |
| `--parser=<id>` | auto-detect | Restrict parser for file input: `prisma` / `laravel` / `json` |
| `--port=<n>` | `7337` | Port to run the local server on |
| `--autoopen` (`--auto-open`) | off | Auto-open the browser after server starts |
| `--share` | off | Save layout to `.schema-viz.json` in the project root (see [Layout persistence](#layout-persistence)) |

```bash
schema-viz ./prisma/schema
schema-viz ./prisma/schema.prisma --port=8080
schema-viz ./schema.json --autoopen
schema-viz --url postgresql://user:pass@localhost:5432/mydb
schema-viz "mysql://user:pass@localhost:3306/mydb"
```

Use the path keyword **`test`** to load the bundled sample project under `test-fixtures/<parser>` (default parser `prisma`; use `--parser laravel` or `--parser json` for the other fixtures). From the repo: `npm run test-fixtures` parses all three and exits non-zero on failure.

Database mode uses `pg` / `mysql2`, honors TLS-related URL options (e.g. `?sslmode=require`), redacts passwords in startup logs, and does not watch files—refresh the page to re-introspect.

---

## Navigation

| Action | Control |
|---|---|
| Pan | Click and drag |
| Scroll vertically | Scroll |
| Scroll horizontally | Shift + scroll |
| Zoom | Ctrl + scroll |
| Zoom in / out | `+` / `−` buttons |
| Reset pan & zoom | Reset view button |
| Select table | Click table card |
| Deselect | Click canvas background |

---

## Layout persistence

Every time you drag a table or pan/zoom the canvas, the layout is saved automatically through the local server — no manual action needed. The viewport resets with **Reset view** (top-right), but your table positions are preserved.

### Default — personal cache

By default the layout is written to a JSON file under `~/.schema-viz/`, keyed by a hash of the project path.

```
~/.schema-viz/
  a3f8c2d1e5b7c9f0.json   ← layout for one project
  f1e2d3c4b5a69870.json   ← layout for another
```

This is private to your machine and survives across browser restarts and device switches.

### `--share` — commit alongside your project

Pass `--share` to save the layout into `.schema-viz.json` at the project root instead:

```bash
schema-viz ./prisma/schema --share
```

```
your-project/
  prisma/schema.prisma
  .schema-viz.json        ← committed layout, shared with the team
```

Any team member who runs `schema-viz --share` from the same project will load the same table positions.

> **To clear a layout**, delete the corresponding file:
>
> ```bash
> # Default cache — remove the file for a specific project
> rm ~/.schema-viz/<hash>.json
>
> # Or wipe the entire cache
> rm -rf ~/.schema-viz/
>
> # Share mode
> rm .schema-viz.json
> ```

---

## From GitHub

```bash
git clone https://github.com/rexers/schema-viz.git
cd schema-viz
npm install
npm run build:ui

# Run against any schema
npx tsx src/cli.ts ./prisma/schema
```

To use it from any project, add an alias to your shell profile (`~/.bashrc` / `~/.zshrc`):

```bash
alias schema-viz="npx tsx /path/to/schema-viz/src/cli.ts"
```

### Development

```bash
# Terminal 1 — API server (default: no browser auto-open)
npx tsx src/cli.ts ./prisma/schema

# Terminal 2 — Vite dev server with hot reload
npm run dev:ui
```

### Adding a new parser

Create `src/parsers/<name>.ts` implementing the `Parser` interface, then register it in `src/parsers/index.ts`:

```ts
export const myParser: Parser = {
  name: "My ORM",
  detect(inputPath) { return inputPath.endsWith(".myext") },
  parse(inputPath) {
    return { models: [...], relations: [...], modelsByGroup: {}, parserName: "my-orm" }
  },
}
```

The frontend requires no changes — it renders whatever `SchemaData` the parser returns.

---

## Roadmap

- **More schema formats** — SQLAlchemy (Python), TypeORM, Drizzle ORM, Ruby on Rails migrations, Sequelize, Hibernate / JPA, and raw SQL (`CREATE TABLE` statements).
- **Layout improvements** — manual column pinning, family-aware edge routing, and configurable grouping rules.
- **Export** — PNG / SVG snapshot of the current diagram.
- **Search & filter** — highlight tables by name, group, or relation depth.
- **Multi-schema overlay** — compare two schema versions side-by-side.

---

## License

MIT — [Rexers Research](https://github.com/rexers)
