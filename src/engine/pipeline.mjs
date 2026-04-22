import path from "node:path";
import { ClaudeAgent, CodexAgent } from "./agents.mjs";
import { runPlanner } from "./planner.mjs";
import { runExecutor } from "./executor.mjs";
import {
  createInitialState,
  loadState,
  saveState,
} from "../core/state.mjs";
import { ensureDir, nowStamp } from "../core/utils.mjs";

function createAgents({
  workspace,
  runDir,
  codexBin,
  claudeBin,
  codexModel,
  claudeModel,
  dangerousClaudePermissions,
  agentConfig,
}) {
  const codexAgent = new CodexAgent({
    bin: codexBin,
    workspace,
    runDir,
    model: agentConfig?.codex?.model || codexModel,
    effort: agentConfig?.codex?.effort || "",
    sandbox: agentConfig?.codex?.sandbox || "",
    phaseModels: agentConfig?.codex?.phaseModels || {},
    phaseEfforts: agentConfig?.codex?.phaseEfforts || {},
    phaseSandboxes: agentConfig?.codex?.phaseSandboxes || {},
  });
  const claudeAgent = new ClaudeAgent({
    bin: claudeBin,
    workspace,
    runDir,
    model: agentConfig?.claude?.model || claudeModel,
    permission: agentConfig?.claude?.permission || "",
    phaseModels: agentConfig?.claude?.phaseModels || {},
    phasePermissions: agentConfig?.claude?.phasePermissions || {},
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
  agentConfig = null,
  onPlanReady = null,
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
    agentConfig,
  });

  let state = await loadState(workspace);

  if (!state && resumeOnly) {
    return { status: "error", error: "이어서 실행할 state.json이 없습니다. 먼저 plan을 실행하세요." };
  }

  if (!state) {
    state = createInitialState({ task: userTask });
    state = await saveState(workspace, state);
  }

  let planningRan = false;
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
    planningRan = true;
  }

  if (onPlanReady && planningRan && !resumeOnly) {
    const gateResult = await onPlanReady(state);
    if (gateResult && gateResult.action === "abort") {
      return { status: "aborted", state };
    } else if (gateResult && gateResult.action === "revise") {
      state = await saveState(workspace, { ...state, phase: "planning" });
      const revisedTask = `${userTask || state.task}\n\n[사용자 수정 요청]: ${gateResult.note}`;
      const reviseResult = await runPlanner({
        workspace,
        userTask: revisedTask,
        codexAgent,
        claudeAgent,
        state,
        planningRounds,
        ui,
      });
      if (reviseResult.status !== "ok") {
        return reviseResult;
      }
      state = reviseResult.state;
    }
    // action:"go" or falsy → fall through to executor
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
