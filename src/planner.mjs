import path from "node:path";
import {
  buildPlanFinalizationPrompt,
  debateSystemPrompt,
  planFinalizationSchema,
  renderFeaturePlanMarkdown,
  renderPlanSummaryMarkdown,
  renderPlanningTranscript,
  validatePlanFinalizationShape,
} from "./prompts.mjs";
import {
  requestUserInput,
  runPlanningWorkshop,
} from "./orchestrator.mjs";
import { collectWorkspaceContext } from "./context.mjs";
import {
  Spinner,
  claude as claudeColor,
  codex as codexColor,
  withSpinner,
} from "./terminal.mjs";
import {
  commandExists,
  ensureDir,
  printSection,
  truncate,
  writeJson,
  writeText,
} from "./utils.mjs";
import { setFeaturesFromPlan, setPhase, saveState } from "./state.mjs";

async function finalizePlan({
  codexAgent,
  claudeAgent,
  context,
  userTask,
  workshopRounds,
  workshopUserInputs,
  spinner,
}) {
  const transcript = renderPlanningTranscript(workshopRounds, workshopUserInputs);
  const userContributions = workshopUserInputs.length
    ? workshopUserInputs.map((entry) => `User ${entry.index}: ${entry.text}`).join("\n")
    : "(none)";

  const codexPrompt = buildPlanFinalizationPrompt({
    agentName: "Codex",
    otherAgentName: "Claude",
    userTask,
    context,
    transcript: truncate(transcript, 16_000),
    userContributions,
  });
  const claudePrompt = buildPlanFinalizationPrompt({
    agentName: "Claude",
    otherAgentName: "Codex",
    userTask,
    context,
    transcript: truncate(transcript, 16_000),
    userContributions,
  });

  const codexResult = await withSpinner(
    spinner,
    `${codexColor("Codex")} is finalizing plan...`,
    () => codexAgent.runStructured({
      name: "plan-finalization",
      prompt: codexPrompt,
      schema: planFinalizationSchema,
    }),
  );

  const claudeResult = await withSpinner(
    spinner,
    `${claudeColor("Claude")} is finalizing plan...`,
    () => claudeAgent.runStructured({
      name: "plan-finalization",
      prompt: claudePrompt,
      schema: planFinalizationSchema,
      systemPrompt: debateSystemPrompt("Claude", "Codex"),
      disableTools: true,
    }),
  );

  if (!codexResult.ok || !claudeResult.ok) {
    return {
      ok: false,
      error: codexResult.error || claudeResult.error,
    };
  }

  if (
    !validatePlanFinalizationShape(codexResult.parsed) ||
    !validatePlanFinalizationShape(claudeResult.parsed)
  ) {
    return { ok: false, error: "Invalid plan finalization shape" };
  }

  // Codex의 plan을 채택하되 둘 다 저장.
  return {
    ok: true,
    plan: codexResult.parsed,
    alt: claudeResult.parsed,
  };
}

async function verifyPlanCommands(workspace, planResult) {
  const warnings = [];
  for (const key of ["test_command", "lint_command"]) {
    const command = planResult[key];
    if (!command || command === "true") continue;
    const head = command.split(/\s+/)[0];
    if (!head) continue;
    const exists = await commandExists(head);
    if (!exists) {
      warnings.push(`${key} '${command}' 의 '${head}' 바이너리를 찾지 못했습니다.`);
    }
  }
  return warnings;
}

export async function runPlanner({
  workspace,
  userTask,
  codexAgent,
  claudeAgent,
  state,
  planningRounds,
  ui,
}) {
  const spinner = new Spinner();
  const artifactsRoot = path.join(workspace, ".agent-debate");
  await ensureDir(artifactsRoot);

  if (ui?.section) ui.section("Workspace Context");
  else printSection("Workspace Context");

  const context = await collectWorkspaceContext(workspace);
  await writeJson(path.join(artifactsRoot, "workspace-context.json"), context);

  if (ui?.section) ui.section("Planning Workshop");
  else printSection("Planning Workshop");

  const workshop = await runPlanningWorkshop({
    codexAgent,
    claudeAgent,
    context,
    userTask,
    runDir: artifactsRoot,
    maxRounds: planningRounds,
    ui,
    spinner,
  });

  if (workshop.status === "error") {
    return {
      status: "error",
      error: `Planning workshop failed: ${workshop.error?.codex || workshop.error?.claude}`,
    };
  }
  if (workshop.status === "paused_for_user") {
    return { status: "paused_for_user" };
  }

  if (ui?.section) ui.section("Plan Finalization");
  else printSection("Plan Finalization");

  const finalized = await finalizePlan({
    codexAgent,
    claudeAgent,
    context,
    userTask,
    workshopRounds: workshop.rounds,
    workshopUserInputs: workshop.userInputs,
    spinner,
  });

  if (!finalized.ok) {
    return { status: "error", error: finalized.error };
  }

  const warnings = await verifyPlanCommands(workspace, finalized.plan);
  if (warnings.length) {
    const reply = await requestUserInput({
      ui,
      title: "You",
      instructions: [
        "플랜 검증 경고:",
        ...warnings,
        "",
        "그대로 진행하려면 /proceed, 종료하려면 /stop, 또는 수정 지시를 입력하세요.",
      ].join("\n"),
      commands: [
        { name: "proceed", description: "그대로 진행" },
        { name: "stop", description: "세션 종료" },
      ],
    });
    if (reply.type === "command" && reply.command === "stop") {
      return { status: "paused_for_user" };
    }
  }

  // 상태 갱신 + 마크다운 영속화
  let nextState = setFeaturesFromPlan(state, finalized.plan);
  nextState = setPhase(nextState, "executing");

  const planMd = renderPlanSummaryMarkdown(finalized.plan, userTask);
  await writeText(path.join(workspace, nextState.planFile), planMd);

  const plansDir = path.join(workspace, ".agent-debate", "plans");
  await ensureDir(plansDir);
  for (const feature of nextState.features) {
    await writeText(path.join(workspace, feature.planFile), renderFeaturePlanMarkdown(feature));
  }

  await writeJson(path.join(artifactsRoot, "plan-finalization.json"), {
    primary: finalized.plan,
    alt: finalized.alt,
  });

  nextState = await saveState(workspace, nextState);

  return { status: "ok", state: nextState, plan: finalized.plan };
}
