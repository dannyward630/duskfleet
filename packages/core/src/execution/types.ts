/**
 * Execution abstraction. This is the only contract the rest of DuskFleet
 * uses to run an agent. `ClaudeCodeExecutor` is the one implementation today.
 */
import type { EffortLevel, PermissionMode } from "../config/types.js";
import type { RecordedCommand } from "../observability/run.js";

export interface ExecutionRequest {
  /** Working directory for the child process. Must already be validated. */
  cwd: string;
  prompt: string;
  /** Session id chosen by the caller so it is known before the process starts. */
  sessionId: string;
  permissionMode: PermissionMode;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  effort?: EffortLevel;
  maxBudgetUsd?: number;
  /** Drop --strict-mcp-config so the run sees the user's MCP servers (claude.ai connectors, .mcp.json). */
  inheritMcp?: boolean;
  /** Passed as --add-dir. */
  addDirs?: string[];
  /** Passed as --agent: adopt a project-defined Claude Code agent. */
  claudeAgent?: string;
  timeoutMs?: number;
  /** Absolute path of the file that receives every raw event line. */
  logPath?: string;
}

/** Structured events emitted while the process runs. */
export type ExecutionEvent =
  | { type: "init"; sessionId: string; model: string | null; tools: string[]; mcpServers: McpServerInfo[]; cliVersion: string | null }
  | { type: "tool_use"; name: string; id: string | null; input?: unknown }
  | { type: "assistant_text"; text: string }
  | { type: "stderr"; text: string }
  | { type: "parse_error"; line: string };

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export type ExecutionOutcome = "completed" | "failed" | "cancelled" | "timed_out";

export interface McpServerInfo {
  name: string;
  status: string;
}

/** MCP visibility for a run: what Claude Code reported mounted, which servers tools were actually called on,
 *  and allow-list entries that matched nothing mounted (likely a naming mismatch such as plugin_* vs claude_ai_*). */
export interface RunMcpInfo {
  mounted: McpServerInfo[];
  used: string[];
  allowListedMissing: string[];
}

/** One tool call the permission system refused. Unattended runs cannot prompt, so this means the allow-list is incomplete. */
export interface DeniedTool {
  tool: string;
  /** Command / file / first string argument, shortened. */
  summary: string | null;
}

export interface ExecutionResult {
  outcome: ExecutionOutcome;
  sessionId: string;
  model: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  /** Termination reason as reported by the tool (e.g. Claude's terminal_reason / subtype). */
  terminationReason: string | null;
  error: string | null;
  resultText: string | null;
  numTurns: number | null;
  toolCalls: number;
  usage: TokenUsage;
  costUsd: number | null;
  permissionDenials: number;
  deniedTools: DeniedTool[];
  /** Heuristic: the run stopped because the context window was exhausted. */
  contextExhausted: boolean;
  /** Full raw result object from the tool, for later analysis. */
  rawResult: unknown;
}

export interface ExecutionHandle {
  command: RecordedCommand;
  pid: number | null;
  done: Promise<ExecutionResult>;
  cancel(): void;
}

export interface Executor {
  readonly name: string;
  /** Resolved binary path, for diagnostics and for recording in the Run. */
  readonly binary: string;
  version(): Promise<string>;
  execute(request: ExecutionRequest, onEvent?: (event: ExecutionEvent) => void): ExecutionHandle;
}
