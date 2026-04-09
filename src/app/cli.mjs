import path from "node:path";
import os from "node:os";
import { ensureAuthenticated, getAuthStatus } from "../core/auth.mjs";
import { startChatSession } from "./chat-session.mjs";
import { runOrchestrator } from "../engine/orchestrator.mjs";
import { ClaudeAgent, CodexAgent } from "../engine/agents.mjs";
import { runFullPipeline, runPlanOnly, runResume } from "../engine/pipeline.mjs";
import { loadState } from "../core/state.mjs";
import {
  commandExists,
  pathExists,
  printSection,
} from "../core/utils.mjs";

const homeDir = os.homedir();

const PHASES = ["plan", "debate", "implement", "review"];

function envPhaseMap(prefix) {
  const map = {};
  for (const phase of PHASES) {
    const key = `${prefix}_${phase.toUpperCase()}`;
    if (process.env[key]) {
      map[phase] = process.env[key];
    }
  }
  return map;
}

function applyCheapPreset(config) {
  for (const phase of ["debate", "review"]) {
    if (config.codex.phaseEfforts[phase] == null) {
      config.codex.phaseEfforts[phase] = "low";
    }
    if (config.claude.phasePermissions[phase] == null) {
      config.claude.phasePermissions[phase] = "plan";
    }
  }
}

function applyMaxPreset(config) {
  for (const phase of PHASES) {
    if (config.codex.phaseEfforts[phase] == null) {
      config.codex.phaseEfforts[phase] = "high";
    }
  }
  for (const phase of PHASES) {
    if (config.claude.phasePermissions[phase] == null) {
      config.claude.phasePermissions[phase] =
        phase === "implement" ? "dontAsk" : "default";
    }
  }
}

function buildAgentConfig() {
  return {
    codex: {
      model: process.env.DEBATE_CODEX_MODEL || "",
      effort: process.env.DEBATE_CODEX_EFFORT || "",
      sandbox: process.env.DEBATE_CODEX_SANDBOX || "",
      phaseModels: envPhaseMap("DEBATE_CODEX_MODEL"),
      phaseEfforts: envPhaseMap("DEBATE_CODEX_EFFORT"),
      phaseSandboxes: envPhaseMap("DEBATE_CODEX_SANDBOX"),
    },
    claude: {
      model: process.env.DEBATE_CLAUDE_MODEL || "",
      permission: process.env.DEBATE_CLAUDE_PERMISSION || "",
      phaseModels: envPhaseMap("DEBATE_CLAUDE_MODEL"),
      phasePermissions: envPhaseMap("DEBATE_CLAUDE_PERMISSION"),
    },
  };
}

function tryPhaseFlag(arg, next, prefix, target) {
  for (const phase of PHASES) {
    if (arg === `${prefix}-${phase}`) {
      target[phase] = next;
      return true;
    }
  }
  return false;
}

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
    agentConfig: buildAgentConfig(),
    preset: "",
  };

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    options.command = "help";
    return options;
  }

  // 서브커맨드는 플래그 앞뒤 어디에도 올 수 있다 (예: --cheap doctor)
  const SUBCOMMANDS = ["chat", "doctor", "run", "plan", "status", "pipeline"];
  const subcmdIdx = args.findIndex((a) => SUBCOMMANDS.includes(a));
  if (subcmdIdx !== -1) {
    options.command = args[subcmdIdx];
    args.splice(subcmdIdx, 1);
    // doctor/status는 플래그 파싱 후 반환하므로 여기서는 continue
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
      options.agentConfig.codex.model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--claude-model") {
      options.claudeModel = args[index + 1];
      options.agentConfig.claude.model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--codex-effort") {
      options.agentConfig.codex.effort = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--codex-sandbox") {
      options.agentConfig.codex.sandbox = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--claude-permission") {
      options.agentConfig.claude.permission = args[index + 1];
      index += 1;
      continue;
    }
    if (tryPhaseFlag(arg, args[index + 1], "--codex-model", options.agentConfig.codex.phaseModels)) {
      index += 1;
      continue;
    }
    if (tryPhaseFlag(arg, args[index + 1], "--codex-effort", options.agentConfig.codex.phaseEfforts)) {
      index += 1;
      continue;
    }
    if (tryPhaseFlag(arg, args[index + 1], "--codex-sandbox", options.agentConfig.codex.phaseSandboxes)) {
      index += 1;
      continue;
    }
    if (tryPhaseFlag(arg, args[index + 1], "--claude-model", options.agentConfig.claude.phaseModels)) {
      index += 1;
      continue;
    }
    if (tryPhaseFlag(arg, args[index + 1], "--claude-permission", options.agentConfig.claude.phasePermissions)) {
      index += 1;
      continue;
    }
    if (arg === "--cheap") {
      options.preset = "cheap";
      continue;
    }
    if (arg === "--max") {
      options.preset = "max";
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

  if (options.preset === "cheap") applyCheapPreset(options.agentConfig);
  if (options.preset === "max") applyMaxPreset(options.agentConfig);

  return options;
}

function displayValue(value) {
  return value || "—";
}

function printAgentMatrix(config) {
  const codexAgent = new CodexAgent({
    bin: "",
    workspace: "",
    runDir: "",
    model: config.codex.model,
    effort: config.codex.effort,
    sandbox: config.codex.sandbox,
    phaseModels: config.codex.phaseModels,
    phaseEfforts: config.codex.phaseEfforts,
    phaseSandboxes: config.codex.phaseSandboxes,
  });
  const claudeAgent = new ClaudeAgent({
    bin: "",
    workspace: "",
    runDir: "",
    model: config.claude.model,
    permission: config.claude.permission,
    phaseModels: config.claude.phaseModels,
    phasePermissions: config.claude.phasePermissions,
  });
  const codexModel = (phase) => displayValue(codexAgent.resolveModel(phase));
  const codexEffort = (phase) => displayValue(codexAgent.resolveEffort(phase));
  const codexSandbox = (phase) => codexAgent.describeSandbox(phase);
  const claudeModel = (phase) => displayValue(claudeAgent.resolveModel(phase));
  const claudePerm = (phase) => claudeAgent.describePermission(phase);

  const header =
    "Phase     | Codex (model / effort / sandbox)                | Claude (model / permission)";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const phase of PHASES) {
    const codex = `${codexModel(phase)} / ${codexEffort(phase)} / ${codexSandbox(phase)}`;
    const claude = `${claudeModel(phase)} / ${claudePerm(phase)}`;
    console.log(`${phase.padEnd(9)} | ${codex.padEnd(48)}| ${claude}`);
  }
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

  console.log("");
  printSection("Phase Matrix");
  printAgentMatrix(options.agentConfig);

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
  --codex-model <name>             (also --codex-model-{plan|debate|implement|review})
  --codex-effort <low|medium|high> (also --codex-effort-<phase>)
  --codex-sandbox <mode>           (also --codex-sandbox-<phase>)
  --claude-model <name>            (also --claude-model-<phase>)
  --claude-permission <mode>       (also --claude-permission-<phase>)
  --cheap                          debate/review만 다운시프트
  --max                            전 phase effort=high
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
      agentConfig: options.agentConfig,
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
      agentConfig: options.agentConfig,
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
      agentConfig: options.agentConfig,
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
      agentConfig: options.agentConfig,
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
