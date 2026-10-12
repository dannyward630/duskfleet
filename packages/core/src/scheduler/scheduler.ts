/**
 * In-process scheduler. One tick every `tickMs`: take the lease, re-read config
 * (kill switch), fire every due schedule through RunManager, advance next_run_at.
 *
 * Policies, deliberately simple:
 *  - No catch-up. A schedule that was due while nobody was running is not fired
 *    late; its next_run_at is recomputed from now. Hourly jobs do not want a burst.
 *  - Busy is a skip, never a queue. RunManager's per-agent / per-project guards
 *    throw; the firing is recorded as `skipped_busy`.
 *  - Only one process ticks: the SQLite lease (see ScheduleRepository) is renewed
 *    every tick and expires after 3 ticks without renewal.
 */
import { hostname } from "node:os";
import type { RunManager } from "../orchestration/run-manager.js";
import type { ScheduleRepository } from "../storage/schedules.js";
import { logger } from "../util/log.js";
import { createSchedule, formatHolder, nextRunAtFor, updateSchedule, type SchedulerRole } from "./crud.js";
import type { Schedule, ScheduleInput, ScheduleOutcome, SchedulePatch } from "./types.js";

const log = logger("scheduler");

export interface SchedulerOptions {
  tickMs?: number;
  /** Identifies this process in the lease; defaults to `<role>@host:pid`. */
  holder?: string;
  /** What kind of process this is (`serve`, `mcp`, `cli`); the dashboard shows it as the lease holder. */
  role?: SchedulerRole;
  now?: () => Date;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  holder: string;
  leaseHeldByThisProcess: boolean;
  lease: { holder: string; expiresAt: string } | null;
  tickMs: number;
  lastTickAt: string | null;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly tickMs: number;
  private readonly holder: string;
  private readonly now: () => Date;
  private lastTickAt: string | null = null;
  private leaseHeld = false;
  private ticking = false;

  constructor(
    private readonly repo: ScheduleRepository,
    private readonly runs: RunManager,
    options: SchedulerOptions = {},
  ) {
    this.tickMs = options.tickMs ?? 30_000;
    this.holder = options.holder ?? formatHolder(options.role ?? "unknown", hostname(), process.pid);
    this.now = options.now ?? (() => new Date());
  }

  // ---- CRUD (validation lives in crud.ts so MCP, CLI, dashboard and tests share it) ----

  create(input: ScheduleInput): Schedule {
    const created = createSchedule(this.repo, this.runs.config, input, this.now());
    log.info("schedule created", { id: created.id, name: created.name, cron: created.cron, tz: created.timeZone, next: created.nextRunAt });
    return created;
  }

  update(id: string, patch: SchedulePatch): Schedule {
    const updated = updateSchedule(this.repo, this.runs.config, id, patch, this.now());
    log.info("schedule updated", { id, name: updated.name, enabled: updated.enabled, next: updated.nextRunAt });
    return updated;
  }

  delete(id: string): boolean {
    return this.repo.delete(id);
  }

  list(): Schedule[] {
    return this.repo.list();
  }

  get(id: string): Schedule | null {
    return this.repo.get(id);
  }

  firings(id: string, limit?: number) {
    return this.repo.firings(id, limit);
  }

  /** Fire a schedule right now, outside its cron (manual trigger). Returns the outcome. */
  async fireNow(id: string): Promise<{ outcome: ScheduleOutcome; runId: string | null; error: string | null }> {
    const s = this.repo.get(id);
    if (!s) throw new Error(`schedule not found: ${id}`);
    return this.fire(s, true);
  }

  // ---- loop ----------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
    log.info("scheduler started", { holder: this.holder, tickMs: this.tickMs });
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.leaseHeld) this.repo.releaseLease(this.holder);
    this.leaseHeld = false;
  }

  status(): SchedulerStatus {
    return {
      enabled: this.runs.config.scheduler.enabled,
      running: this.timer !== null,
      holder: this.holder,
      leaseHeldByThisProcess: this.leaseHeld,
      lease: this.repo.leaseInfo(),
      tickMs: this.tickMs,
      lastTickAt: this.lastTickAt,
    };
  }

  /** One pass. Public so tests can drive it without timers. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = this.runs.reloadConfig(); // kill switch and agent/project edits apply without restart
      this.lastTickAt = this.now().toISOString();
      if (!config.scheduler.enabled) {
        if (this.leaseHeld) this.repo.releaseLease(this.holder);
        this.leaseHeld = false;
        return;
      }
      this.leaseHeld = this.repo.acquireLease(this.holder, this.tickMs * 3);
      if (!this.leaseHeld) return;

      for (const s of this.repo.due(this.now().toISOString())) {
        await this.fire(s, false);
      }
    } catch (err) {
      log.error("tick failed", { err: err instanceof Error ? err.message : String(err) });
    } finally {
      this.ticking = false;
    }
  }

  // ---- internals -----------------------------------------------------------

  private async fire(s: Schedule, manual: boolean): Promise<{ outcome: ScheduleOutcome; runId: string | null; error: string | null }> {
    const nextRunAt = s.enabled ? this.computeNext(s.cron, s.timeZone) : null;
    if (!s.enabled && !manual) {
      this.repo.recordFiring(s.id, "skipped_disabled", null, null, nextRunAt);
      return { outcome: "skipped_disabled", runId: null, error: null };
    }
    try {
      const input: Parameters<RunManager["startRun"]>[0] = { prompt: s.prompt, agentId: s.agentId, scheduleId: s.id };
      if (s.projectId) input.projectId = s.projectId;
      if (s.model) input.model = s.model;
      const run = await this.runs.startRun(input);
      this.repo.recordFiring(s.id, "started", run.id, null, nextRunAt);
      log.info("schedule fired", { schedule: s.name, runId: run.id, manual });
      return { outcome: "started", runId: run.id, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const busy = /\b(project busy|agent busy|max_concurrent_runs)\b/.test(message);
      const outcome: ScheduleOutcome = busy ? "skipped_busy" : "error";
      this.repo.recordFiring(s.id, outcome, null, message, nextRunAt);
      (busy ? log.info : log.warn)("schedule not started", { schedule: s.name, outcome, message });
      return { outcome, runId: null, error: message };
    }
  }

  private computeNext(cron: string, timeZone: string): string | null {
    return nextRunAtFor(cron, timeZone, this.now());
  }
}
