/**
 * Parser for Claude Code's `--output-format stream-json` (one JSON object per line).
 *
 * Shapes verified against Claude Code 2.1.285:
 *   {"type":"system","subtype":"init","session_id","model","tools",...,"claude_code_version"}
 *   {"type":"assistant","message":{"model","usage",content:[{type:"text"|"tool_use",...}]}}
 *   {"type":"user", ...}                                     (tool results)
 *   {"type":"result","subtype","is_error","session_id","result","num_turns","duration_ms",
 *      "total_cost_usd","usage":{...},"modelUsage":{...},"permission_denials":[...],
 *      "terminal_reason","stop_reason"}
 *
 * Unknown fields and unknown line types are ignored so CLI upgrades degrade gracefully.
 */
import { summarizeToolInput } from "../orchestration/tool-summary.js";
import type { DeniedTool, ExecutionEvent, TokenUsage } from "./types.js";

export interface ParsedResult {
  isError: boolean;
  subtype: string | null;
  terminalReason: string | null;
  stopReason: string | null;
  sessionId: string | null;
  resultText: string | null;
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number | null;
  usage: TokenUsage;
  permissionDenials: number;
  deniedTools: DeniedTool[];
  modelUsed: string | null;
  raw: unknown;
}

export interface StreamState {
  sessionId: string | null;
  model: string | null;
  toolCalls: number;
  lastAssistantText: string | null;
  result: ParsedResult | null;
  parseErrors: number;
}

export function createStreamState(): StreamState {
  return { sessionId: null, model: null, toolCalls: 0, lastAssistantText: null, result: null, parseErrors: 0 };
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Feed one line. Returns the structured events it produced (may be empty). */
export function ingestLine(state: StreamState, line: string): ExecutionEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    state.parseErrors += 1;
    return [{ type: "parse_error", line: trimmed.slice(0, 500) }];
  }
  if (!isObject(msg)) return [];

  const events: ExecutionEvent[] = [];
  switch (msg["type"]) {
    case "system": {
      if (msg["subtype"] === "init") {
        state.sessionId = str(msg["session_id"]) ?? state.sessionId;
        state.model = str(msg["model"]) ?? state.model;
        const tools = Array.isArray(msg["tools"]) ? msg["tools"].filter((t): t is string => typeof t === "string") : [];
        // Connectors may still be connecting at init time (list seen empty while MCP tools were later used).
        const mcpServers = (Array.isArray(msg["mcp_servers"]) ? msg["mcp_servers"] : [])
          .filter(isObject)
          .map((s) => ({ name: str(s["name"]) ?? "unknown", status: str(s["status"]) ?? "unknown" }));
        events.push({
          type: "init",
          sessionId: state.sessionId ?? "",
          model: state.model,
          tools,
          mcpServers,
          cliVersion: str(msg["claude_code_version"]),
        });
      }
      break;
    }
    case "assistant": {
      const message = msg["message"];
      if (!isObject(message)) break;
      const model = str(message["model"]);
      if (model && model !== "<synthetic>") state.model = model;
      const content = message["content"];
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (!isObject(block)) continue;
        if (block["type"] === "tool_use") {
          state.toolCalls += 1;
          events.push({ type: "tool_use", name: str(block["name"]) ?? "unknown", id: str(block["id"]), input: block["input"] });
        } else if (block["type"] === "text") {
          const text = str(block["text"]);
          if (text) {
            state.lastAssistantText = text;
            events.push({ type: "assistant_text", text });
          }
        }
      }
      break;
    }
    case "result": {
      state.result = parseResult(msg);
      if (state.result.sessionId) state.sessionId = state.result.sessionId;
      break;
    }
    default:
      break;
  }
  return events;
}

function parseResult(msg: Json): ParsedResult {
  const usage = isObject(msg["usage"]) ? msg["usage"] : {};
  const deniedTools: DeniedTool[] = (Array.isArray(msg["permission_denials"]) ? msg["permission_denials"] : [])
    .filter(isObject)
    .map((d) => {
      const tool = str(d["tool_name"]) ?? "unknown";
      return { tool, summary: summarizeToolInput(tool, d["tool_input"]) };
    });
  const denials = deniedTools.length;

  // modelUsage is keyed by model id; when exactly one model was used, report it.
  let modelUsed: string | null = null;
  if (isObject(msg["modelUsage"])) {
    const keys = Object.keys(msg["modelUsage"]);
    if (keys.length >= 1) modelUsed = keys.join(",");
  }

  return {
    isError: msg["is_error"] === true,
    subtype: str(msg["subtype"]),
    terminalReason: str(msg["terminal_reason"]),
    stopReason: str(msg["stop_reason"]),
    sessionId: str(msg["session_id"]),
    resultText: str(msg["result"]),
    numTurns: num(msg["num_turns"]),
    durationMs: num(msg["duration_ms"]),
    costUsd: num(msg["total_cost_usd"]),
    usage: {
      inputTokens: num(usage["input_tokens"]),
      outputTokens: num(usage["output_tokens"]),
      cacheReadTokens: num(usage["cache_read_input_tokens"]),
      cacheCreationTokens: num(usage["cache_creation_input_tokens"]),
    },
    permissionDenials: denials,
    deniedTools,
    modelUsed,
    raw: msg,
  };
}

/**
 * Heuristic for context-window exhaustion. The exact signal Claude Code emits
 * is not documented, so we look at the fields most likely to carry it and
 * keep the raw result for later refinement.
 */
/**
 * Only structured signals count: terminal reason, result subtype, stop reason, and
 * the result text *when the run is an error*. Scanning a successful run's prose
 * produced false positives (a reviewer writing "context" and "limitation" was
 * flagged on 2026-10-08).
 */
export function looksLikeContextExhaustion(result: ParsedResult | null): boolean {
  if (!result) return false;
  const structured = [result.terminalReason, result.subtype, result.stopReason]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  if (/context[_ ]?(window|limit|exhaust)|prompt[_ ]too[_ ]long|max_turns|max_tokens/.test(structured)) return true;
  if (result.isError && result.resultText) {
    const err = result.resultText.slice(0, 500).toLowerCase();
    return err.includes("prompt is too long") || err.includes("context window") || err.includes("context limit");
  }
  return false;
}
