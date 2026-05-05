# Schema Viz

> Universal database schema visualizer — point it at a schema file or directory and get an interactive ER diagram in your browser, with pan, zoom, and live reload.

**Supported formats:** Prisma · JSON

---

## Installation

```bash
npm install -g schema-viz
```

---

## Usage

```bash
schema-viz <path> [options]
```

| Option | Default | Description |
|---|---|---|
| `--port=<n>` | `7337` | Port to run the local server on |
| `--no-open` | — | Don't auto-open the browser |

```bash
schema-viz ./prisma/schema
schema-viz ./prisma/schema.prisma --port=8080
schema-viz ./schema.json --no-open
```

**Supported formats:** Prisma · JSON

---

## Navigation

| Action | Control |
|---|---|
| Pan | Click and drag |
| Scroll vertically | Scroll |
| Scroll horizontally | Shift + scroll |
| Zoom | Ctrl + scroll |
| Zoom in / out | `+` / `−` buttons |
| Reset view | Reset button |

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
# Terminal 1 — API server (no browser)
npx tsx src/cli.ts ./prisma/schema --no-open

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

## License

MIT — [Rexers Research](https://github.com/rexers)
