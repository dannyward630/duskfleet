#!/usr/bin/env node
/**
 * Fake Claude Code binary for smoke tests. Emits stream-json lines in the
 * shapes verified against Claude Code 2.1.285, without calling any API.
 *
 * Behaviour is chosen by the prompt (last argv element):
 *   "ok"     -> tool_use + text + successful result (default)
 *   "error"  -> result with is_error=true
 *   "hang"   -> emits init then sleeps forever (for cancel / timeout tests)
 *   "crash"  -> exits 3 with no result line
 */
const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? "ok";
const sessionIdx = args.indexOf("--session-id");
const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : "00000000-0000-0000-0000-000000000000";
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1] : "claude-haiku-4-5-20251001";

if (args[0] === "--version") {
  process.stdout.write("9.9.9 (fake)\n");
  process.exit(0);
}

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

out({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sessionId, tools: ["Bash", "Edit", "Read"], mcp_servers: [{ name: "claude.ai Figma", status: "connected" }], model, permissionMode: "acceptEdits", claude_code_version: "9.9.9" });

if (prompt === "hang") {
  setInterval(() => {}, 1000); // keep alive until killed
} else if (prompt === "crash") {
  process.exit(3);
} else {
  out({ type: "assistant", message: { model, role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "hello.txt" } }], usage: { input_tokens: 10, output_tokens: 5 } } });
  out({ type: "user", message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: "ok" }] } });
  out({ type: "assistant", message: { model, role: "assistant", content: [{ type: "text", text: "Done: created hello.txt" }], usage: { input_tokens: 12, output_tokens: 8 } } });
  const isError = prompt === "error";
  out({
    type: "result",
    subtype: isError ? "error_during_execution" : "success",
    is_error: isError,
    duration_ms: 1234,
    duration_api_ms: 1000,
    num_turns: 2,
    result: isError ? "API Error: something went wrong" : "Done: created hello.txt",
    session_id: sessionId,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 22, output_tokens: 13, cache_creation_input_tokens: 328, cache_read_input_tokens: 24254 },
    modelUsage: { [model]: { inputTokens: 22, outputTokens: 13 } },
    permission_denials: prompt === "denied" ? [{ tool_name: "Bash" }] : [],
    terminal_reason: isError ? "api_error" : "completed",
    stop_reason: "end_turn",
  });
  process.exit(isError ? 1 : 0);
}
