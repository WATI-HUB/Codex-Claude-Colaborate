#!/usr/bin/env node
/**
 * Non-interactive end-to-end smoke test for the new pipeline.
 * Runs plan → execute on the e2e-fixture workspace.
 *
 * Usage: node e2e-test.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFullPipeline } from "./src/engine/pipeline.mjs";
import { commandExists, pathExists } from "./src/core/utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const homeDir = (await import("node:os")).default.homedir();

const FIXTURE_DIR = path.join(__dirname, "e2e-fixture");
const SMOKE_FILE = path.join(FIXTURE_DIR, "smoke.txt");
const STATE_DIR = path.join(FIXTURE_DIR, ".agent-debate");
const EXPECTED_CONTENT = "E2E_OK";

async function resolveBinary(preferredPath, fallbackCommand) {
  if (preferredPath && (await pathExists(preferredPath))) return preferredPath;
  if (fallbackCommand && (await commandExists(fallbackCommand))) return fallbackCommand;
  return null;
}

async function cleanup() {
  try { await fs.unlink(SMOKE_FILE); } catch {}
  try { await fs.rm(STATE_DIR, { recursive: true, force: true }); } catch {}
}

async function main() {
  console.log("=== E2E Smoke Test (new pipeline) ===\n");

  const codexBin = await resolveBinary(
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
  );
  const claudeBin = await resolveBinary(
    path.join(homeDir, ".local/bin/claude"),
    "claude",
  );

  if (!codexBin) { console.error("FAIL: Codex binary not found"); process.exit(1); }
  if (!claudeBin) { console.error("FAIL: Claude binary not found"); process.exit(1); }

  console.log(`Codex: ${codexBin}`);
  console.log(`Claude: ${claudeBin}`);

  await cleanup();
  console.log("Cleaned smoke.txt and .agent-debate\n");

  const task = [
    "Low-token smoke test. Keep all responses extremely short.",
    "Plan exactly ONE feature: create smoke.txt with content E2E_OK (no trailing newline).",
    "test_command and lint_command MUST be exactly 'true' (the unix true command).",
    "git_strategy: base_branch=main, branch_prefix=feature/.",
    "In the feature debate, converge in round 1.",
    "Reviewers: approve immediately if smoke.txt exists with content E2E_OK.",
  ].join(" ");

  let result;
  try {
    result = await runFullPipeline({
      workspace: FIXTURE_DIR,
      userTask: task,
      codexBin,
      claudeBin,
      planningRounds: 1,
    });
  } catch (err) {
    console.error(`\nFAIL: pipeline threw:\n${err.stack || err.message}`);
    process.exit(1);
  }

  console.log(`\nPipeline result: ${JSON.stringify(result.status)}`);

  const errors = [];
  if (result.status !== "completed") {
    errors.push(`Expected status "completed", got "${result.status}" (${result.error || ""})`);
  }
  try {
    const content = await fs.readFile(SMOKE_FILE, "utf8");
    if (content !== EXPECTED_CONTENT) {
      errors.push(`smoke.txt content is "${content}", expected "${EXPECTED_CONTENT}"`);
    }
  } catch {
    errors.push("smoke.txt does not exist after pipeline");
  }

  if (errors.length) {
    console.error("\nFAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("\nPASSED.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
