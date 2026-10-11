# DuskFleet

> Formerly known as Gab Factory. Package scope, config file, database and env vars were renamed
> on 2026-10-11; an existing `data/gabfactory.db` is adopted automatically on first start.

A local platform for orchestrating, observing and (eventually) scheduling and evaluating
autonomous coding agents that run on top of **Claude Code**.

```
Claude Cowork / Claude Desktop
        │  MCP (stdio)
        ▼
  DuskFleet MCP server ──▶ Orchestration ──▶ Claude Code CLI ──▶ your local project
        │
        ▼
  SQLite (runs, events, evals)  +  data/logs/<run_id>.jsonl
```

You describe *what should happen* in `config/` (agents, projects). DuskFleet records
*what happened* in `data/duskfleet.db`. See [PLAN.md](PLAN.md) for the design.

## Requirements

- macOS or Linux
- Node.js **24+** (uses the built-in `node:sqlite`, no native addons)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and **logged in** for the
  user that will run DuskFleet (`claude` once interactively, or `claude auth`). DuskFleet does not
  manage authentication.

## Repository layout

npm workspaces, three deliverables sharing one `config/` and one SQLite database:

```
duskfleet/
├── config/              declarative config: duskfleet.yaml, agents/*.md, projects.yaml (Git)
├── data/                runtime: duskfleet.db + logs/<run_id>.jsonl (git-ignored)
├── packages/
│   ├── core/            @duskfleet/core — domain: config, storage, execution, orchestration, evals
│   └── mcp/             @duskfleet/mcp  — MCP server (stdio) + CLI + tests
└── apps/
    └── web/             @duskfleet/web  — Next.js dashboard (read-only)
```

`core` has no knowledge of MCP or React. `mcp` and `web` both depend on `core` and nothing else
from each other. The dashboard reads the database the MCP server writes (SQLite WAL allows this).
Its only writes are to *user* agent files (`data/agents`): delete an agent, remove a `claude_agent`
link. It never mutates runs or builtins, and it has no authentication: keep it on localhost.

## Install

```bash
git clone <this repo> duskfleet
cd duskfleet
npm install            # all workspaces
npm run build          # core + mcp
npm run cli -- doctor
```

`doctor` prints the Claude binary it found, its version, and where config and data live.

## Configure

Everything declarative lives in `config/` and is meant to be committed to Git.

### `config/duskfleet.yaml`

```yaml
data_dir: ../data               # SQLite + logs (git-ignored)
allowed_project_roots: []       # e.g. [~/Documents/Projects]; empty = any directory except / and ~
default_agent: null              # or an agent id; null = run_agent requires agent_id
max_concurrent_runs: 2
claude:
  binary: null                  # set to /Users/you/.local/bin/claude if PATH is minimal (GUI launch)
  strict_mcp_config: true       # child sessions ignore user-level MCP servers (faster, no hangs)
  setting_sources: null         # or [project, local] to skip ~/.claude/settings.json (user hooks) in runs
  allow_bypass_permissions: false
  default_timeout_minutes: 30
  default_max_budget_usd: 5
```

### Agents

**Two kinds, choose explicitly.** Every agent is either

| Kind | What it is | Required | Not allowed |
|---|---|---|---|
| **own** | A new agent whose persona lives in DuskFleet: the Markdown body is the system prompt | `system_prompt` (body) | `claude_agent` |
| **link** | A reference to an agent that a project **folder** already defines in `.claude/agents/<name>.md`. The run starts as `claude --agent <name>` in that folder: the project agent brings prompt, tools and model; DuskFleet adds only the unattended envelope (permissions, allow-list, budget, MCP, optional extra instructions) | `claude_agent` + the folder: `project_path` (absolute; registered as a project on the fly if new) or a registered `project` id. The target file is verified to exist | — |

`create_agent` makes you say which one (`kind: "own" | "link"`) and rejects inconsistent
combinations; `list_agents` reports `kind` for every agent and the dashboard shows
"link → name" or "own prompt". Rule of thumb: if the project already has a `.claude/agents/`
entry that does the job, link it; write a persona only when nothing exists.

Agent files are Markdown with YAML frontmatter; the body is appended to Claude Code's system prompt.
They live in two places:

| Where | Who writes it | Purpose |
|---|---|---|
| `config/agents/<id>.md` | you, in Git | **builtin** agents committed with the repo |
| `data/agents/<id>.md` (`user_agents_dir`) | `create_agent` over MCP, or by hand | **user** agents, git-ignored. Same id as a builtin = override |

Both are re-read on every run and every `list_agents` call, so edits apply without restarting
anything. Code never writes into `config/agents`.

```markdown
---
id: my-coder
name: My coder
description: Implements the task it is given.
# model: sonnet
permission_mode: acceptEdits      # acceptEdits | dontAsk | auto | manual  (plan and bypassPermissions: see below)
# allowed_tools: ["Bash(npm test:*)", "mcp__claude_ai_Atlassian_Rovo"]
# disallowed_tools: ["Edit", "Write", "NotebookEdit"]   # read-only agent
# project: my-app                 # bind to a project: grouped under it, default target, refused elsewhere
# inherit_mcp: true               # see "MCP servers inside runs"
# add_dirs: ["~/Documents/Projects/other-repo"]        # --add-dir; runs are confined to the project otherwise
# effort: high
timeout_minutes: 30
max_budget_usd: 5
---
You are running unattended. Finish the task end to end and summarise what you changed.
```

Permission modes map 1:1 to `claude --permission-mode`. Runs always add
`--permission-prompts none`: nobody can answer a prompt, so anything not covered by
`allowed_tools` is denied and recorded on the run as `deniedTools` (one entry per refused
call, with the command or file) and `permissionDenials`. A run with denials shows as
**needs review** in the dashboard: it means the allow-list is incomplete, not that a human
stepped in. `--permission-prompts none` also ignores the project's own `.claude/settings`
allow-lists and confines file tools to the project directory (`add_dirs` widens that).

Verified against Claude Code 2.1.295 on 2026-10-08 with real runs:

| Mode | Unattended behaviour |
|---|---|
| `acceptEdits` | Edits in the project allowed; Bash and MCP only if allow-listed |
| `dontAsk` | Same, nothing prompts. **Use this for read-only agents** together with `disallowed_tools: [Edit, Write, NotebookEdit]`, which removes those tools from the session |
| `plan` | Blocks Bash, MCP and file writes entirely, allow-list or not. Useless for unattended work |
| `bypassPermissions` | Refused by Claude Code together with `--permission-prompts none`; DuskFleet rejects it with a clear error |

### Grouping agents by project

`project: <id>` on an agent binds it to an entry of `projects.yaml`. Bound agents are grouped
under their project in `list_agents` (`byProject`) and on the dashboard's Agents page, `run_agent`
targets that project when none is given, and a run on any other project is refused. Agents
without `project` are general-purpose and run wherever they are pointed. A `project` that is
not in `projects.yaml` is a config error, caught before the file is written when it comes
through `create_agent`.

### Reusing agents a project already defines

Projects often ship their own Claude Code agents in `.claude/agents/*.md` (persona, tools,
model). Instead of copying that prompt into DuskFleet, link to it:

```markdown
---
id: sl-app
claude_agent: app-coordinator     # <project>/.claude/agents/app-coordinator.md
permission_mode: acceptEdits
inherit_mcp: true
allowed_tools: ["mcp__claude_ai_Atlassian_Rovo", "Bash(yarn:*)", "Bash(git:*)", "Bash(gh pr:*)"]
---
Optional extra instructions, appended after the project agent's own prompt.
```

The run starts as `claude --agent app-coordinator`: the project agent decides who the
model is and what it does; the DuskFleet agent decides what it may do unattended
(permissions, allow-list, budget, MCP). `list_project_agents` shows what a project offers;
a link to a name the project does not define fails before anything is spawned. Note that a
project agent's `tools:` list does not grant permissions in unattended runs: those tools
still need to be in `allowed_tools` here.

### MCP servers inside runs

By default a run starts with `--strict-mcp-config`: no MCP server at all, 25 built-in tools,
no way to recurse into DuskFleet. Set `inherit_mcp: true` on an **agent** or on a
**project** and the run instead sees the MCP servers of the user running DuskFleet,
including the claude.ai connectors (Atlassian, Figma, Gmail, Drive, ...). Verified: 168 tools,
140 of them from connectors. Each server still has to be allow-listed on the agent, by
server (`mcp__claude_ai_Atlassian_Rovo`) or by tool (`mcp__claude_ai_Figma__get_screenshot`).
No `--mcp-config` file is involved: connectors are account-level and already authenticated.

**Names differ by how a server is registered.** The same Atlassian service is
`mcp__plugin_productivity_atlassian__*` when it comes from a Claude Code plugin (user
settings, not loaded in runs) and `mcp__claude_ai_Atlassian_Rovo__*` as a claude.ai
connector (what runs see). Every run records what was mounted and which servers were
actually called (`get_run` → `mcp`, dashboard → Technical details). An allow-list entry
whose server never mounted is reported as `mcp.allowListedMissing`, flags the run as
**needs review** and adds a note event, instead of failing silently.

### Projects: `config/projects.yaml` (optional)

```yaml
projects:
  my-app:
    path: ~/Documents/Projects/my-app
    description: Main web app
```

Callers can then pass `project_id: my-app` instead of a path. Every path is validated at run time:
absolute, exists, is a directory, not `/` or your home directory, and inside
`allowed_project_roots` when that list is set.

Relative project paths resolve from the directory of the file they are in, never from the
shell's cwd. Keep your own projects (machine-specific absolute paths) in the **private**
registry `data/projects.yaml` (`user_projects_file`, git-ignored), same syntax; the versioned
`config/projects.yaml` only carries repo-relative examples. Per project you can also set `inherit_mcp: true` and
`add_dirs: [...]`, which apply to every run on that project whatever the agent says.

### Concurrency

`max_concurrent_runs` caps processes overall; `max_concurrent_per_project` (default 1) keeps
two agents out of the same working copy; `max_concurrent_per_agent` (default 1) is the
agent's WIP limit, so a scheduler tick whose previous run is still going is refused with
`agent busy` rather than doubled. Refusals are errors, not a queue.

## Schedules (cron)

Schedules live in the database and are managed over MCP (`create_schedule`, `update_schedule`,
`delete_schedule`, `run_schedule_now`, `list_schedules`) or read on the dashboard's **Schedules**
page. A schedule is: agent, prompt, 5-field cron, IANA time zone (default `Europe/London`),
optional project (not needed when the agent is bound to one) and model override.

```
0 8-20 * * 1-5     weekdays 08–20 on the hour
30 8-20 * * 1-5    weekdays 08–20 at :30
45 7 * * 1-5       weekdays at 07:45
```

**Who ticks.** Any DuskFleet process can: the MCP server that Claude Desktop or Claude Code
keeps alive, or `duskfleet serve` (a plain long-running process, suited to launchd). A SQLite
lease makes sure only one of them fires at a time; the others stand by and take over when the
holder stops. The dashboard shows which process holds the lease.

**Policies.** A tick whose agent or project is still busy is recorded as `skipped_busy`, never
queued. Missed ticks (nobody running) are not caught up. `scheduler.enabled: false` in
`duskfleet.yaml` is the kill switch, re-read every tick. Every run started by a schedule
carries its `scheduleId`.

## Run locally (CLI)

The CLI uses the same orchestration code as the MCP server and is the quickest way to test.

```bash
npm run cli -- run --project ~/Documents/Projects/my-app -- "Add a README section describing the build"
npm run cli -- run --project-id my-app --agent my-reviewer --model sonnet -- "Review src/ for obvious bugs"
npm run cli -- run --no-wait --project /path -- "..."     # return immediately
npm run cli -- runs --status completed --limit 10
npm run cli -- run-info <run_id> --events
npm run cli -- agents
npm run cli -- projects
```

(`npm run cli --` is shorthand for `node packages/mcp/dist/cli.js`.)

Each run writes a raw event log to `data/logs/<run_id>.jsonl` and a structured row to SQLite.

## Run as an MCP server

Start:

```bash
npm run mcp            # = node packages/mcp/dist/index.js
```

The server speaks MCP over stdio; logs go to stderr. Runs execute as child processes of the
server, so keep it alive while runs are in progress. On restart, any run still marked
`running` is closed as `failed` with an "orphaned" error.

### Connect from Claude Desktop / Claude Cowork

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "duskfleet": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/duskfleet/packages/mcp/dist/index.js"],
      "env": {
        "CLAUDE_BIN": "/Users/you/.local/bin/claude"
      }
    }
  }
}
```

Use absolute paths for `node` (`which node`) and set `CLAUDE_BIN`: GUI apps start with a minimal
`PATH`. Restart Claude Desktop and the `duskfleet` tools appear.

### Connect from Claude Code

```bash
claude mcp add duskfleet -- node /absolute/path/to/duskfleet/packages/mcp/dist/index.js
```

Or copy `.mcp.json.example` to `.mcp.json` in this repo (git-ignored, machine-specific) and
fill in the absolute paths. The dashboard's **MCP** page prints both snippets with your paths.

### Environment variables

| Variable | Purpose |
|---|---|
| `DUSKFLEET_CONFIG` | Directory containing `duskfleet.yaml` (default: the closest ancestor `config/` of the running package / cwd) |
| `CLAUDE_BIN` | Path to the Claude Code binary (overrides config) |
| `DUSKFLEET_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Dashboard (Next.js)

```bash
npm run web            # dev server on http://localhost:4777
# or: npm run build:web && npm run start -w @duskfleet/web
```

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
- **Agents**: every agent grouped by project ("Any project" first) with model, permission mode,
  allow-lists (collapsed past 4 entries), limits, prompt preview and aggregate stats.
- **Schedules**: state, cron (human and raw), next tick (theoretical one for paused schedules),
  last outcome and firing history, with copyable `update_schedule` / `create_schedule` examples.
- **MCP**: the tool catalogue (`packages/mcp/dist/tools.json`) with a sticky index, plus the
  registration snippets for Claude Desktop and Claude Code.

The dashboard is read-only by design: the Claude Code child processes belong to the MCP server
process, so cancelling goes through `cancel_run` (Cowork) or the CLI. It can run while the MCP
server is running or not; it only needs `config/` and `data/duskfleet.db`.

## MCP tools

| Tool | What it does |
|---|---|
| `list_agents` | Builtin (`config/agents`) and user (`user_agents_dir`) agents with their `source` |
| `create_agent` | Write a user agent. **`kind` is required**: `own` (new persona, `system_prompt` required) or `link` (reuse an agent from a project folder: `claude_agent` + `project_path` or `project`, target verified; a new folder is registered in `data/projects.yaml`). Then `id`, optional `name`, `description`, `model`, `permission_mode`, `allowed_tools`, `disallowed_tools`, `effort`, `timeout_minutes`, `max_budget_usd`, `system_prompt`, `inherit_mcp`, `add_dirs`, `claude_agent`, `project`. `overwrite: true` replaces a user agent or overrides a builtin. `bypassPermissions` is not offered. |
| `list_project_agents` | Agents a project defines in `.claude/agents/*.md` (name, description, tools, model), to reuse via `claude_agent` |
| `update_agent` | Merge fields into a user agent; `clear: [...]` removes optional fields. Pass `kind` to convert: `link` (with `claude_agent`) or `own` (with a `system_prompt`); `clear: ["claude_agent"]` unlinks and therefore needs a prompt. Builtins are read-only (override them instead). |
| `delete_agent` | Remove a user agent file; the builtin with the same id, if any, takes over again |
| `list_projects` | Named projects, allowed roots, executor info |
| `list_schedules` | Schedules with next/last firing, outcome (`started` \| `skipped_busy` \| `error`) and scheduler status (kill switch, lease holder) |
| `create_schedule` | `name`, `agent_id`, `prompt`, `cron`, optional `time_zone`, `project_id`, `model`, `enabled` |
| `update_schedule` | Merge fields; `enabled: false` pauses, `true` resumes from now |
| `delete_schedule` | Remove a schedule |
| `run_schedule_now` | Fire a schedule immediately, same busy rules as a tick |
| `run_agent` | Start a run. `prompt` + (`project_path` \| `project_id`), optional `agent_id`, `model`, `wait_seconds` (≤300). Returns the run immediately unless waiting. |
| `get_run` | Full run record incl. `claudeSessionId`, `resumeCommand`, tokens, cost, status. `include_output: true` adds the final message and event timeline. |
| `list_runs` | Recent runs with filters (`status`, `agent_id`, `project_path`, `limit`) |
| `cancel_run` | SIGTERM (then SIGKILL) the run's process; recorded as `cancelled` |

A typical conversation from Claude Desktop or Claude Code:

> "Create a duskfleet agent `test-fixer` using haiku that may run `npm test` and never edits tests."
> → `create_agent` writes `data/agents/test-fixer.md`, usable immediately

> "Run the my-coder agent on ~/Projects/my-app: add input validation to the signup form."
> → `run_agent` returns `run_id` + `claudeSessionId`
> "How is it going?" → `get_run`
> "Show me what it said" → `get_run` with `include_output`
> Open the session yourself: `claude --resume <claudeSessionId>` inside the project.

## What a Run records

`id`, `agentId`, `projectPath`, `prompt`, `modelRequested`/`modelUsed`, `status`
(`pending → running → completed | failed | cancelled | timed_out`), timestamps and duration,
`claudeSessionId`, `permissionMode`, the exact `command` (binary, argv, cwd), `exitCode`,
`terminationReason`, `error`, `resultText`, `numTurns`, `toolCalls`, input/output/cache tokens,
`costUsd`, `permissionDenials`, `humanIntervention`, `contextExhausted`, `logPath`.

## Security model

- The project path is passed as the child's **working directory**; nothing is ever built into a
  shell string (`spawn(binary, argv, { shell: false })`).
- Project paths are validated before anything runs; `allowed_project_roots` fences them.
- Permission mode is explicit per agent; `bypassPermissions` is off unless enabled in config.
- Every run stores the full command it executed.
- Child processes inherit your environment (so Claude auth works) minus the variables that mark a
  nested Claude Code session.

## Code map

```
packages/core/src/config         YAML/Markdown loaders, repo-root discovery
packages/core/src/storage        node:sqlite, migrations, RunRepository
packages/core/src/execution      Executor interface, ClaudeCodeExecutor, stream-json parser
packages/core/src/orchestration  RunManager, state machine, project validation
packages/core/src/observability  Run model
packages/core/src/evals          types + repository (foundation only)
packages/core/src/scheduler      interface only
packages/core/src/index.ts       public API of @duskfleet/core
packages/mcp/src/mcp             MCP server + tools (one file per tool group)
packages/mcp/src/cli.ts          local CLI
packages/mcp/src/index.ts        MCP server entry point
packages/mcp/test                fake Claude binary + tests
apps/web/app                     Next.js routes: /, /agents, /runs/[id]
apps/web/lib/data.ts             server-only read access to config + SQLite
```

## Tests

```bash
npm run build && npm test
```

The tests use `packages/mcp/test/fake-claude.js`, a stand-in for the Claude binary that replays the real
`stream-json` event shapes, so they run in about 20 seconds with no API calls. They cover the
executor, state machine, SQLite storage, validation and the MCP server driven over stdio.

## Troubleshooting

- **`doctor` cannot find `claude`** — set `claude.binary` in `duskfleet.yaml` or `CLAUDE_BIN`.
- **A run never finishes although the agent already answered** — a user-level hook in
  `~/.claude/settings.json` (for example a `Stop` hook that shows a desktop notification) may be
  blocking in a headless context. Set `claude.setting_sources: [project, local]` so runs skip
  user-level settings, or make the hook non-blocking. Inspect `data/logs/<run_id>.jsonl`: if the
  last line is an `assistant` message with no `result` line, this is the cause.
- **`bypassPermissions` rejected** — enable `claude.allow_bypass_permissions` deliberately; it maps
  to `--dangerously-skip-permissions`.
- **Runs failed with "orphaned"** — DuskFleet was restarted while they were running. Resume the
  Claude session with the `resumeCommand` from `get_run` if you want to continue the work.

## Extending

- **New MCP tool**: add a file in `packages/mcp/src/mcp/tools/`, register it in `packages/mcp/src/mcp/server.ts`.
- **New agent**: drop a Markdown file in `config/agents/`.
- **Schema change**: append a migration in `packages/core/src/storage/db.ts`.
- **New dashboard view**: add a route under `apps/web/app/` and a query in `apps/web/lib/data.ts`.
- **Scheduling / evals**: implement the interfaces in `packages/core/src/scheduler/types.ts` and `packages/core/src/evals/types.ts`;
  the run pipeline does not need to change.
