/**
 * The publishable `duskfleet` package (packages/duskfleet, assembled by scripts/assemble-package.mjs
 * during `npm run build`): the bundled CLI runs with core inside the package, and `--help` needs no
 * config (a fresh `npx duskfleet --help`).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { testEnv } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeBinary = path.join(here, "fake-claude.js");
const workspaceCli = path.join(here, "..", "dist", "cli.js");
const bundleDir = path.join(here, "..", "..", "duskfleet", "dist");

function run(entry, args, env = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "duskfleet-pkg-cwd-"));
  try {
    return spawnSync(process.execPath, [entry, ...args], {
      cwd, // outside the repository: nothing to find by walking up
      env: testEnv({ DUSKFLEET_LOG_LEVEL: "warn", ...env }),
      encoding: "utf8",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

test("--help prints the usage on stdout with exit 0 and loads no config; no command is still exit 2", () => {
  const missing = path.join(tmpdir(), "duskfleet-no-such-config");
  for (const flag of ["--help", "-h", "help"]) {
    const r = run(workspaceCli, [flag], { DUSKFLEET_CONFIG: missing });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Duskfleet - A fleet of agents for your own machine\.\n\nUsage:/);
    assert.match(r.stdout, /duskfleet doctor \[--probe\]/);
  }
  const none = run(workspaceCli, [], { DUSKFLEET_CONFIG: missing });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Usage:/);
});

test("the duskfleet bundle carries core, imports no @duskfleet/core and ships no maps or declarations", () => {
  assert.ok(existsSync(path.join(bundleDir, "cli.js")), "packages/duskfleet/dist is missing: run npm run build");
  assert.ok(existsSync(path.join(bundleDir, "core", "index.js")), "core is bundled under dist/core");
  for (const file of walk(bundleDir)) {
    assert.ok(file.endsWith(".js") || path.basename(file) === "tools.json", `unexpected file in the bundle: ${file}`);
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /(["'])@duskfleet\/core(\/[^"']*)?\1/, `${file} still imports @duskfleet/core`);
    assert.doesNotMatch(text, /sourceMappingURL/, `${file} points at a source map that is not shipped`);
  }
  for (const bin of ["cli.js", "index.js"]) {
    assert.match(
      readFileSync(path.join(bundleDir, bin), "utf8"),
      /^#!\/usr\/bin\/env node\n/,
      `${bin} keeps its shebang`,
    );
  }
});

test("the bundled CLI runs: --help without config, doctor on a config with the fake claude", () => {
  const entry = path.join(bundleDir, "cli.js");
  const help = run(entry, ["--help"], { DUSKFLEET_CONFIG: path.join(tmpdir(), "duskfleet-no-such-config") });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);

  const root = mkdtempSync(path.join(tmpdir(), "duskfleet-pkg-"));
  try {
    const configDir = path.join(root, "config");
    mkdirSync(path.join(configDir, "agents"), { recursive: true });
    writeFileSync(
      path.join(configDir, "duskfleet.yaml"),
      `data_dir: ../data\nclaude:\n  binary: ${JSON.stringify(fakeBinary)}\n`,
    );
    const doctor = run(entry, ["doctor"], { DUSKFLEET_CONFIG: configDir });
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.claudeVersion, "9.9.9 (fake)");
    assert.equal(report.configDir, configDir);
    assert.ok(existsSync(path.join(root, "data", "duskfleet.db")), "the bundled core opened the database");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
