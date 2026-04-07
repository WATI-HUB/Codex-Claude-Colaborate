import path from "node:path";
import { ClaudeAgent, CodexAgent } from "./agents.mjs";
import { runPlanner } from "./planner.mjs";
import { runExecutor } from "./executor.mjs";
import {
  createInitialState,
  loadState,
  saveState,
} from "./state.mjs";
import { ensureDir, nowStamp } from "./utils.mjs";

function createAgents({
  workspace,
  runDir,
  codexBin,
  claudeBin,
  codexModel,
  claudeModel,
  dangerousClaudePermissions,
}) {
  const codexAgent = new CodexAgent({
    bin: codexBin,
    workspace,
    runDir,
    model: codexModel,
  });
  const claudeAgent = new ClaudeAgent({
    bin: claudeBin,
    workspace,
    runDir,
    model: claudeModel,
    dangerousSkipPermissions: dangerousClaudePermissions,
  });
  return { codexAgent, claudeAgent };
}

export async function runFullPipeline({
  workspace,
  userTask,
  codexBin,
  claudeBin,
  codexModel,
  claudeModel,
  planningRounds = 3,
  dangerousClaudePermissions = false,
  ui = null,
  resumeOnly = false,
  planOnly = false,
}) {
  const artifactsRoot = path.join(workspace, ".agent-debate");
  await ensureDir(artifactsRoot);
  const runDir = path.join(artifactsRoot, "runs", nowStamp());
  await ensureDir(runDir);

  const { codexAgent, claudeAgent } = createAgents({
    workspace,
    runDir,
    codexBin,
    claudeBin,
    codexModel,
    claudeModel,
    dangerousClaudePermissions,
  });

  let state = await loadState(workspace);

  if (!state && resumeOnly) {
    return { status: "error", error: "이어서 실행할 state.json이 없습니다. 먼저 plan을 실행하세요." };
  }

  if (!state) {
    state = createInitialState({ task: userTask });
    state = await saveState(workspace, state);
  }

  if (state.phase === "planning" && !resumeOnly) {
    const planResult = await runPlanner({
      workspace,
      userTask: userTask || state.task,
      codexAgent,
      claudeAgent,
      state,
      planningRounds,
      ui,
    });
    if (planResult.status !== "ok") {
      return planResult;
    }
    state = planResult.state;
  }

  if (planOnly) {
    return { status: "planned", state };
  }

  if (state.phase === "executing") {
    const execResult = await runExecutor({
      workspace,
      state,
      codexAgent,
      claudeAgent,
      ui,
    });
    return execResult;
  }

  if (state.phase === "completed") {
    return { status: "completed", state };
  }

  return { status: "error", error: `Unknown phase: ${state.phase}` };
}

export async function runPlanOnly(options) {
  return runFullPipeline({ ...options, planOnly: true });
}

export async function runResume(options) {
  return runFullPipeline({ ...options, resumeOnly: true });
}
