#!/usr/bin/env node
/**
 * Small local CLI. Same orchestration layer as the MCP server, useful for
 * testing without an MCP client.
 *
 *   duskfleet agents
 *   duskfleet projects
 *   duskfleet run --project <path> [--agent <id>] [--model <m>] [--no-wait] -- "<prompt>"
 *   duskfleet runs [--status <s>] [--limit <n>]
 *   duskfleet run-info <run_id> [--events]
 *   duskfleet schedules
 *   duskfleet tools            # MCP tool catalogue (names, descriptions, input schemas)
 *   duskfleet serve            # long-running scheduler process (launchd/cron host)
 *   duskfleet doctor
 */
import { parseArgs } from "node:util";
import { bootstrap } from "./bootstrap.js";
import { buildToolCatalog } from "./tools-catalog.js";
import { summarizeRun } from "@duskfleet/core";
import { RUN_STATUSES, type RunStatus } from "@duskfleet/core";

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  duskfleet agents",
      "  duskfleet projects",
      '  duskfleet run --project <path> [--agent <id>] [--model <m>] [--no-wait] -- "<prompt>"',
      "  duskfleet runs [--status <status>] [--limit <n>]",
      "  duskfleet run-info <run_id> [--events]",
      "  duskfleet schedules",
      "  duskfleet tools",
      "  duskfleet serve",
      "  duskfleet doctor",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();
  if (command === "tools") {
    print(await buildToolCatalog());
    return;
  }

  const app = await bootstrap(import.meta.url);
  const done = (code = 0) => {
    app.close();
    process.exit(code);
  };

  switch (command) {
    case "agents": {
      print([...app.config.agents.values()].map(({ systemPrompt: _p, ...a }) => a));
      return done();
    }
    case "projects": {
      print({ allowedProjectRoots: app.config.allowedProjectRoots, projects: [...app.config.projects.values()] });
      return done();
    }
    case "doctor": {
      let version: string | null = null;
      let error: string | null = null;
      try {
        version = await app.executor.version();
      } catch (err) {
        error = String(err);
      }
      print({
        node: process.version,
        claudeBinary: app.executor.binary,
        claudeVersion: version,
        error,
        configDir: app.config.configDir,
        dataDir: app.config.dataDir,
        agents: [...app.config.agents.keys()],
      });
      return done(error ? 1 : 0);
    }
    case "run": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          project: { type: "string", short: "p" },
          "project-id": { type: "string" },
          agent: { type: "string", short: "a" },
          model: { type: "string", short: "m" },
          "no-wait": { type: "boolean", default: false },
        },
      });
      const prompt = positionals.join(" ").trim();
      if (!prompt || (!values.project && !values["project-id"])) usage();

      const input: Parameters<typeof app.runs.startRun>[0] = { prompt };
      if (values.project) input.projectPath = values.project;
      if (values["project-id"]) input.projectId = values["project-id"];
      if (values.agent) input.agentId = values.agent;
      if (values.model) input.model = values.model;

      let run = await app.runs.startRun(input);
      process.stderr.write(`run ${run.id} started (session ${run.claudeSessionId})\nlog: ${run.logPath}\n`);
      if (!values["no-wait"]) {
        run = await app.runs.waitForRun(run.id, 24 * 60 * 60 * 1000);
      }
      print(run);
      return done(run.status === "completed" || run.status === "running" ? 0 : 1);
    }
    case "runs": {
      const { values } = parseArgs({
        args: rest,
        options: { status: { type: "string" }, limit: { type: "string" }, agent: { type: "string" } },
      });
      const filter: Parameters<typeof app.runs.listRuns>[0] = {};
      if (values.status) {
        if (!(RUN_STATUSES as readonly string[]).includes(values.status)) usage();
        filter.status = values.status as RunStatus;
      }
      if (values.limit) filter.limit = Number(values.limit);
      if (values.agent) filter.agentId = values.agent;
      print(app.runs.listRuns(filter).map(summarizeRun));
      return done();
    }
    case "schedules": {
      print({ scheduler: app.scheduler.status(), schedules: app.scheduler.list() });
      return done();
    }
    case "serve": {
      // Keeps the scheduler ticking without any MCP host. Safe next to the MCP server:
      // only the lease holder fires. Stop with SIGINT/SIGTERM.
      app.scheduler.start();
      process.stderr.write(`duskfleet serve: scheduler ticking every ${app.config.scheduler.tickSeconds}s (holder ${app.scheduler.status().holder}); Ctrl-C to stop\n`);
      const stop = () => {
        app.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {}); // run forever
      return;
    }
    case "run-info": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { events: { type: "boolean", default: false } },
      });
      const id = positionals[0];
      if (!id) usage();
      const run = app.runs.getRun(id);
      if (!run) {
        process.stderr.write(`run not found: ${id}\n`);
        return done(1);
      }
      const subagents = app.runs.agents(id);
      print(values.events ? { ...run, subagents, events: app.runs.events(id) } : { ...run, subagents });
      return done();
    }
    default:
      usage();
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
