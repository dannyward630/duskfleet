# Dashboard

```bash
npm run web            # dev server on http://localhost:4777
# or: npm run build:web && npm run start -w @duskfleet/web
```

A Next.js app that reads the database the MCP server writes (SQLite WAL mode). It can run
while the MCP server is running or not; it only needs `config/` and `data/duskfleet.db`. It
has no authentication: keep it on localhost.

Five views. The runs list and a running run's detail auto-refresh every 3 seconds (pause button
in the nav); the other pages are static.

- **Runs**: KPI cards (clean runs, needs review, spend) computed on the current filter; project /
  agent chips, prompt search (`?q=`), `?schedule=` and `?limit=` (load older). Runs are identified
  by a short title (first line of the prompt); the whole row links to the detail.
- **Run detail**: short title, status line, duration / cost / turns / tool calls / tokens, the
  issues (denied calls highlighted in the timeline, missing MCP servers, context exhaustion),
  final message (long results collapse), event timeline with legend and grouped repeats,
  previous / next run of the same agent, a "run again" CLI command, the `claude --resume`
  command and the exact command executed. Home paths print as `~/…`; Copy buttons give the
  full value.
- **Agents**: every agent grouped by project ("Any project" first) with kind ("link → name" or
  "own prompt"), model (with a warning when not set), permission mode, allow-lists (collapsed
  past 4 entries), limits, prompt preview and aggregate stats. User agents can be deleted or
  unlinked from here, with an inline confirmation; builtins are read-only.
- **Schedules**: state, cron (human and raw), next tick (theoretical one for paused schedules),
  last outcome and firing history, with copyable `update_schedule` / `create_schedule` examples.
- **MCP**: the tool catalogue (`packages/mcp/dist/tools.json`, generated at build time from the
  real server) with a sticky index, plus the registration snippets for Claude Desktop and
  Claude Code with your absolute paths.

A completed run that hit a permission denial or an allow-listed MCP server that never mounted
is **needs review** (amber), never plain green.

The dashboard is read-only by design: the Claude Code child processes belong to the MCP server
process, so cancelling goes through `cancel_run` (Cowork) or the CLI. Its only writes are the
two actions on user agent files (delete, unlink); it never mutates runs or builtins.
