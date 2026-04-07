import path from "node:path";
import os from "node:os";
import { ensureAuthenticated, getAuthStatus } from "../core/auth.mjs";
import { startChatSession } from "./chat-session.mjs";
import { runOrchestrator } from "../engine/orchestrator.mjs";
import { runFullPipeline, runPlanOnly, runResume } from "../engine/pipeline.mjs";
import { loadState } from "../core/state.mjs";
import {
  commandExists,
  pathExists,
  printSection,
} from "../core/utils.mjs";

const homeDir = os.homedir();

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    command: "chat",
    task: "",
    workspace: process.env.DEBATE_WORKSPACE || process.cwd(),
    planningRounds: Number(process.env.DEBATE_PLANNING_ROUNDS || 3),
    debateRounds: Number(process.env.DEBATE_ROUNDS || 3),
    repairRounds: Number(process.env.DEBATE_REPAIR_ROUNDS || 2),
    maxCycles: Number(process.env.DEBATE_MAX_CYCLES || 3),
    codexBin:
      process.env.DEBATE_CODEX_BIN ||
      "/Applications/Codex.app/Contents/Resources/codex",
    claudeBin:
      process.env.DEBATE_CLAUDE_BIN || path.join(homeDir, ".local/bin/claude"),
    codexModel: process.env.DEBATE_CODEX_MODEL || "",
    claudeModel: process.env.DEBATE_CLAUDE_MODEL || "",
    skipWorkshop: process.env.DEBATE_SKIP_WORKSHOP === "1",
    dangerousClaudePermissions: process.env.DEBATE_CLAUDE_DANGEROUS === "1",
  };

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    options.command = "help";
    return options;
  }

  if (args[0] === "chat") {
    options.command = "chat";
    args.shift();
  }

  if (args[0] === "doctor") {
    options.command = "doctor";
    return options;
  }

  if (args[0] === "run") {
    options.command = "run";
    args.shift();
  }

  if (args[0] === "plan") {
    options.command = "plan";
    args.shift();
  }

  if (args[0] === "status") {
    options.command = "status";
    args.shift();
  }

  if (args[0] === "pipeline") {
    options.command = "pipeline";
    args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace" || arg === "-C") {
      options.workspace = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--debate-rounds") {
      options.debateRounds = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--planning-rounds") {
      options.planningRounds = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--repair-rounds") {
      options.repairRounds = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--max-cycles") {
      options.maxCycles = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--codex-bin") {
      options.codexBin = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--claude-bin") {
      options.claudeBin = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--codex-model") {
      options.codexModel = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--claude-model") {
      options.claudeModel = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--dangerous-claude") {
      options.dangerousClaudePermissions = true;
      continue;
    }
    if (arg === "--skip-workshop") {
      options.skipWorkshop = true;
      continue;
    }

    options.task = options.task ? `${options.task} ${arg}` : arg;
  }

  return options;
}

async function resolveBinary(preferredPath, fallbackCommand) {
  if (preferredPath && (await pathExists(preferredPath))) {
    return preferredPath;
  }
  if (fallbackCommand && (await commandExists(fallbackCommand))) {
    return fallbackCommand;
  }
  return null;
}

async function doctor(options) {
  printSection("Doctor");

  const codexBin = await resolveBinary(options.codexBin, "codex");
  const claudeBin = await resolveBinary(options.claudeBin, "claude");
  const authStatus =
    codexBin && claudeBin
      ? await getAuthStatus({
          codexBin,
          claudeBin,
          workspace: options.workspace,
        })
      : null;

  console.log(`Workspace: ${options.workspace}`);
  console.log(`Codex binary: ${codexBin || "not found"}`);
  console.log(`Claude binary: ${claudeBin || "not found"}`);
  console.log(
    `Codex login artifact: ${
      authStatus ? (authStatus.codex.artifactFound ? "found" : "missing") : "unknown"
    }`,
  );
  console.log(
    `Claude login artifact: ${
      authStatus ? (authStatus.claude.artifactFound ? "found" : "missing") : "unknown"
    }`,
  );
  console.log(
    `Codex login status: ${
      authStatus ? (authStatus.codex.loggedIn ? "logged in" : "not logged in") : "unknown"
    }`,
  );
  console.log(
    `Claude login shell auth: ${
      authStatus ? (authStatus.claude.loggedIn ? "logged in" : "not logged in") : "unknown"
    }`,
  );

  if (!codexBin || !claudeBin) {
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    console.log(`Usage:
  node src/app/cli.mjs
  node src/app/cli.mjs chat
  node src/app/cli.mjs "작업 지시"
  node src/app/cli.mjs doctor
  node src/app/cli.mjs plan "작업 지시"
  node src/app/cli.mjs run
  node src/app/cli.mjs status
  zsh run-debate.sh
  zsh run-debate.sh "작업 지시"

Options:
  --workspace, -C <path>
  --planning-rounds <n>
  --debate-rounds <n>
  --repair-rounds <n>
  --max-cycles <n>
  --codex-bin <path>
  --claude-bin <path>
  --codex-model <name>
  --claude-model <name>
  --skip-workshop
  --dangerous-claude
`);
    return;
  }

  if (options.command === "doctor") {
    await doctor(options);
    return;
  }

  if (options.command === "status") {
    const state = await loadState(path.resolve(options.workspace));
    if (!state) {
      console.log("state.json 없음. 먼저 plan을 실행하세요.");
      return;
    }
    printSection("State");
    console.log(`Task: ${state.task}`);
    console.log(`Phase: ${state.phase}`);
    console.log(`Test: ${state.testCommand}`);
    console.log(`Lint: ${state.lintCommand}`);
    console.log(`Features (${state.features.length}):`);
    state.features.forEach((f, i) => {
      const marker = i === state.currentFeatureIndex ? "→" : " ";
      console.log(`  ${marker} [${f.status}] ${f.id} — ${f.name}`);
    });
    return;
  }

  const codexBin = await resolveBinary(options.codexBin, "codex");
  const claudeBin = await resolveBinary(options.claudeBin, "claude");

  if (!codexBin) {
    console.error("Codex 실행 파일을 찾지 못했습니다.");
    process.exitCode = 1;
    return;
  }

  if (!claudeBin) {
    console.error("Claude 실행 파일을 찾지 못했습니다.");
    process.exitCode = 1;
    return;
  }

  await ensureAuthenticated({
    workspace: path.resolve(options.workspace),
    codexBin,
    claudeBin,
    onMessage: (message) => console.log(message),
  });

  if (options.command === "chat" && !options.task.trim()) {
    await startChatSession({
      workspace: path.resolve(options.workspace),
      codexBin,
      claudeBin,
      codexModel: options.codexModel || undefined,
      claudeModel: options.claudeModel || undefined,
      planningRounds: options.planningRounds,
      debateRounds: options.debateRounds,
      repairRounds: options.repairRounds,
      maxCycles: options.maxCycles,
      skipWorkshop: options.skipWorkshop,
      dangerousClaudePermissions: options.dangerousClaudePermissions,
    });
    return;
  }

  if (options.command === "plan") {
    if (!options.task.trim()) {
      console.error("plan 명령에는 task 문자열이 필요합니다.");
      process.exitCode = 1;
      return;
    }
    const result = await runPlanOnly({
      workspace: path.resolve(options.workspace),
      userTask: options.task.trim(),
      codexBin,
      claudeBin,
      codexModel: options.codexModel || undefined,
      claudeModel: options.claudeModel || undefined,
      planningRounds: options.planningRounds,
      dangerousClaudePermissions: options.dangerousClaudePermissions,
    });
    printSection("Plan Result");
    console.log(JSON.stringify({ status: result.status, error: result.error }, null, 2));
    return;
  }

  if (options.command === "run") {
    const result = await runResume({
      workspace: path.resolve(options.workspace),
      userTask: options.task.trim(),
      codexBin,
      claudeBin,
      codexModel: options.codexModel || undefined,
      claudeModel: options.claudeModel || undefined,
      planningRounds: options.planningRounds,
      dangerousClaudePermissions: options.dangerousClaudePermissions,
    });
    printSection("Run Result");
    console.log(JSON.stringify({ status: result.status, error: result.error }, null, 2));
    return;
  }

  if (!options.task.trim()) {
    console.error("작업 지시가 비어 있습니다. 예: zsh run-debate.sh 또는 node src/app/cli.mjs \"로그인 화면 고쳐줘\"");
    process.exitCode = 1;
    return;
  }

  // 기본: 새 파이프라인 (full pipeline)
  if (options.command === "pipeline" || options.command === "chat") {
    const result = await runFullPipeline({
      workspace: path.resolve(options.workspace),
      userTask: options.task.trim(),
      codexBin,
      claudeBin,
      codexModel: options.codexModel || undefined,
      claudeModel: options.claudeModel || undefined,
      planningRounds: options.planningRounds,
      dangerousClaudePermissions: options.dangerousClaudePermissions,
    });
    printSection("Pipeline Result");
    console.log(JSON.stringify({ status: result.status, error: result.error }, null, 2));
    return;
  }

  const result = await runOrchestrator({
    workspace: path.resolve(options.workspace),
    userTask: options.task.trim(),
    codexBin,
    claudeBin,
    codexModel: options.codexModel || undefined,
    claudeModel: options.claudeModel || undefined,
    planningRounds: options.planningRounds,
    debateRounds: options.debateRounds,
    repairRounds: options.repairRounds,
    maxCycles: options.maxCycles,
    skipWorkshop: options.skipWorkshop,
    dangerousClaudePermissions: options.dangerousClaudePermissions,
  });

  printSection("Result");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
