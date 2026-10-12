/**
 * Scheduling model. A Schedule says "run this agent with this prompt on this
 * cron, in this time zone". The Scheduler (scheduler.ts) fires due schedules
 * through RunManager, which keeps the WIP guards: a tick whose agent or project
 * is still busy is recorded as `skipped_busy`, never queued.
 */

export type ScheduleOutcome = "started" | "skipped_busy" | "skipped_disabled" | "error";

export interface Schedule {
  id: string;
  name: string;
  agentId: string;
  /** Project id; null when the agent is bound to a project (then its project is used). */
  projectId: string | null;
  prompt: string;
  model: string | null;
  /** 5-field cron expression, evaluated in `timeZone`. */
  cron: string;
  /** IANA zone, e.g. Europe/London. */
  timeZone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** Next instant the scheduler will consider this schedule due. */
  nextRunAt: string | null;
  lastFiredAt: string | null;
  lastOutcome: ScheduleOutcome | null;
  lastError: string | null;
  lastRunId: string | null;
  /** Counters since creation. */
  fires: number;
  skips: number;
  /**
   * Set by `ScheduleRepository.requestRun` (dashboard "Run now"); the lease holder fires the
   * schedule on its next tick, outside its cron and even when paused, and clears it.
   */
  runRequestedAt: string | null;
}

export interface ScheduleInput {
  name: string;
  agentId: string;
  projectId?: string | null;
  prompt: string;
  model?: string | null;
  cron: string;
  timeZone?: string;
  enabled?: boolean;
}

export type SchedulePatch = Partial<ScheduleInput>;

/** One row of the audit trail: every time a schedule was considered due. */
export interface ScheduleFiring {
  id: number;
  scheduleId: string;
  firedAt: string;
  outcome: ScheduleOutcome;
  runId: string | null;
  error: string | null;
}
