import type { RunStatus } from "../observability/run.js";

/**
 * Run state machine.
 *
 *   pending ──▶ running ──▶ completed | failed | cancelled | timed_out
 *      │
 *      └──▶ failed                    (spawn error, validation after creation)
 *   pending ──▶ cancelled             (cancelled before it started)
 */
const TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  pending: new Set(["running", "failed", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled", "timed_out"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  timed_out: new Set(),
};

export class IllegalTransitionError extends Error {
  override readonly name = "IllegalTransitionError";
  constructor(from: RunStatus, to: RunStatus) {
    super(`illegal run transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!TRANSITIONS[from].has(to)) throw new IllegalTransitionError(from, to);
}
