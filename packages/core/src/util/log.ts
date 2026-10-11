/**
 * Minimal stderr logger.
 *
 * stdout is reserved for the MCP stdio transport, so every diagnostic line
 * must go to stderr or it will corrupt the protocol stream.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = (process.env["DUSKFLEET_LOG_LEVEL"] as LogLevel | undefined) ?? "info";
const threshold = LEVELS[configured] ?? LEVELS.info;

function write(level: LogLevel, scope: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const suffix = extra === undefined ? "" : " " + safeJson(extra);
  process.stderr.write(`${ts} [${level}] ${scope}: ${message}${suffix}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => write("debug", scope, m, e),
    info: (m: string, e?: unknown) => write("info", scope, m, e),
    warn: (m: string, e?: unknown) => write("warn", scope, m, e),
    error: (m: string, e?: unknown) => write("error", scope, m, e),
  };
}
