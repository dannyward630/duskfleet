# Schedules (cron)

Schedules live in the database and are managed over MCP (`create_schedule`, `update_schedule`,
`delete_schedule`, `run_schedule_now`, `list_schedules`) or read on the dashboard's **Schedules**
page and with `duskfleet schedules` on the CLI. A schedule is: agent, prompt, 5-field cron,
IANA time zone (default `Europe/London`), optional project (not needed when the agent is bound
to one) and model override.

```
0 8-20 * * 1-5     weekdays 08–20 on the hour
30 8-20 * * 1-5    weekdays 08–20 at :30
45 7 * * 1-5       weekdays at 07:45
```

The cron parser is in-house (no dependency) and DST-safe: it re-derives local time per
candidate minute, so a schedule at 08:00 fires at 08:00 on both sides of a clock change.

## Who ticks

Any DuskFleet process can: the MCP server that Claude Desktop or Claude Code keeps alive, or
`duskfleet serve` (a plain long-running process, suited to launchd):

```bash
npm run cli -- serve
```

A SQLite lease makes sure only one of them fires at a time; the others stand by and take over
when the holder stops. The dashboard shows which process holds the lease.

## Policies

- A tick whose agent or project is still busy is recorded as `skipped_busy`, never queued.
- Missed ticks (nobody running) are not caught up.
- `scheduler.enabled: false` in `duskfleet.yaml` is the kill switch, re-read every tick.
- Every run started by a schedule carries its `scheduleId`.
- New schedules are best created paused (`enabled: false`), tried once with `run_schedule_now`,
  checked on the dashboard (denials, missing MCP servers, cost) and only then enabled.
