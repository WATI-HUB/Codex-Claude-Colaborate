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
import { collectWorkspaceContext } from "../core/context.mjs";
import {
  Spinner,
  bold,
  claude as claudeColor,
  codex as codexColor,
  dim,
  withSpinner,
} from "../core/terminal.mjs";
import {
  commandExists,
  ensureDir,
  printSection,
  truncate,
  writeJson,
  writeText,
} from "../core/utils.mjs";
import { setFeaturesFromPlan, setPhase, saveState } from "../core/state.mjs";

const MAX_PLAN_FINALIZATION_ROUNDS = 3;

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeFeature(feature) {
  return {
    id: normalizeText(feature.id),
    name: normalizeText(feature.name),
    description: normalizeText(feature.description),
    acceptance_criteria: (feature.acceptance_criteria || []).map((item) => normalizeText(item)),
    estimated_complexity: normalizeText(feature.estimated_complexity),
  };
}

function normalizePlanCore(plan) {
  return {
    features: (plan.features || []).map(normalizeFeature),
    test_command: normalizeText(plan.test_command),
    lint_command: normalizeText(plan.lint_command),
    git_strategy: {
      base_branch: normalizeText(plan.git_strategy?.base_branch),
      branch_prefix: normalizeText(plan.git_strategy?.branch_prefix),
    },
  };
}

function plansAreEquivalent(left, right) {
  return JSON.stringify(normalizePlanCore(left)) === JSON.stringify(normalizePlanCore(right));
}

function mergePlanSummaries(left, right) {
  const a = String(left.summary || "").trim();
  const b = String(right.summary || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return [
    "Shared plan rationale:",
    `- ${a}`,
    `- ${b}`,
  ].join("\n");
}

function buildSharedPlan(left, right) {
  return {
    ...left,
    summary: mergePlanSummaries(left, right),
  };
}

function renderPlanSnapshot(plan) {
  return [
    `Summary: ${plan.summary || "(none)"}`,
    `Commands: test=${plan.test_command || "true"} / lint=${plan.lint_command || "true"}`,
    `Git: ${plan.git_strategy?.base_branch || "(none)"} / ${plan.git_strategy?.branch_prefix || "(none)"}`,
    "Features:",
    ...(plan.features || []).map(
      (feature) =>
        `- ${feature.id} | ${feature.name} | ${feature.estimated_complexity} | ${(feature.acceptance_criteria || []).join("; ")}`,
    ),
  ].join("\n");
}

function renderPlanFinalizationTranscript(rounds) {
  if (!rounds.length) {
    return "(none)";
  }

  return rounds.map((round) => [
    `Plan Finalization Round ${round.round}`,
    `[Codex message] ${round.codex.message_to_other}`,
    `[Codex decision] ${round.codex.decision.status} / ${round.codex.decision.reason}`,
    `[Codex plan]`,
    renderPlanSnapshot(round.codex),
    `[Claude message] ${round.claude.message_to_other}`,
    `[Claude decision] ${round.claude.decision.status} / ${round.claude.decision.reason}`,
    `[Claude plan]`,
    renderPlanSnapshot(round.claude),
  ].join("\n")).join("\n\n");
}

function printPlanFinalizationRound(roundNumber, codexPlan, claudePlan) {
  console.log(`\n${bold("[Plan Finalization Round " + roundNumber + "]")}`);
  console.log(`${codexColor("Codex ->")} ${codexPlan.message_to_other}`);
  console.log(dim(`  decision: ${codexPlan.decision.status} / ${codexPlan.decision.reason}`));
  console.log(dim(`  features: ${(codexPlan.features || []).map((feature) => feature.id).join(", ") || "(none)"}`));
  console.log(`${claudeColor("Claude ->")} ${claudePlan.message_to_other}`);
  console.log(dim(`  decision: ${claudePlan.decision.status} / ${claudePlan.decision.reason}`));
  console.log(dim(`  features: ${(claudePlan.features || []).map((feature) => feature.id).join(", ") || "(none)"}`));
}

async function finalizePlan({
  codexAgent,
  claudeAgent,
  context,
  userTask,
  workshopRounds,
  workshopUserInputs,
  spinner,
  runDir,
  maxRounds = MAX_PLAN_FINALIZATION_ROUNDS,
}) {
  const userContributions = workshopUserInputs.length
    ? workshopUserInputs.map((entry) => `User ${entry.index}: ${entry.text}`).join("\n")
    : "(none)";
  const rounds = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const planningTranscript = renderPlanningTranscript(workshopRounds, workshopUserInputs);
    const finalizationTranscript = renderPlanFinalizationTranscript(rounds);
    const transcript = [
      `Planning workshop transcript:\n${planningTranscript}`,
      `Plan finalization transcript:\n${finalizationTranscript}`,
    ].join("\n\n");
    const lastRound = rounds[rounds.length - 1] || null;

    const codexPrompt = buildPlanFinalizationPrompt({
      agentName: "Codex",
      otherAgentName: "Claude",
      userTask,
      context,
      transcript: truncate(transcript, 20_000),
      userContributions,
      roundNumber: round,
      maxRounds,
      previousDraft: lastRound?.codex,
      otherDraft: lastRound?.claude,
    });
    const claudePrompt = buildPlanFinalizationPrompt({
      agentName: "Claude",
      otherAgentName: "Codex",
      userTask,
      context,
      transcript: truncate(transcript, 20_000),
      userContributions,
      roundNumber: round,
      maxRounds,
      previousDraft: lastRound?.claude,
      otherDraft: lastRound?.codex,
    });

    const codexResult = await withSpinner(
      spinner,
      `${codexColor("Codex")} is finalizing plan...`,
      () => codexAgent.runStructured({
        name: `plan-finalization-r${String(round).padStart(2, "0")}`,
        prompt: codexPrompt,
        schema: planFinalizationSchema,
      }),
    );

    const claudeResult = await withSpinner(
      spinner,
      `${claudeColor("Claude")} is finalizing plan...`,
      () => claudeAgent.runStructured({
        name: `plan-finalization-r${String(round).padStart(2, "0")}`,
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

    rounds.push({
      round,
      codex: codexResult.parsed,
      claude: claudeResult.parsed,
    });
    await writeJson(path.join(runDir, "plan-finalization.rounds.json"), rounds);
    printPlanFinalizationRound(round, codexResult.parsed, claudeResult.parsed);

    const equivalent = plansAreEquivalent(codexResult.parsed, claudeResult.parsed);
    const bothAgree =
      codexResult.parsed.decision.status === "agree" &&
      claudeResult.parsed.decision.status === "agree";
    const bothNeedUserInput =
      codexResult.parsed.decision.status === "needs_user_input" &&
      claudeResult.parsed.decision.status === "needs_user_input";

    if (!bothNeedUserInput && (bothAgree || (equivalent && round === maxRounds))) {
      return {
        ok: true,
        plan: buildSharedPlan(codexResult.parsed, claudeResult.parsed),
        alt: {
          codex: codexResult.parsed,
          claude: claudeResult.parsed,
        },
        rounds,
      };
    }

    if (bothNeedUserInput) {
      return {
        ok: false,
        status: "needs_user_input",
        reason: [
          `Codex: ${codexResult.parsed.decision.reason}`,
          `Claude: ${claudeResult.parsed.decision.reason}`,
        ].join("\n"),
        latest: {
          codex: codexResult.parsed,
          claude: claudeResult.parsed,
        },
        rounds,
      };
    }
  }

  const lastRound = rounds[rounds.length - 1];
  return {
    ok: false,
    status: "needs_user_input",
    reason: "최종 플랜 합의에 실패했습니다. 어떤 방향을 우선할지 사용자 판단이 필요합니다.",
    latest: lastRound
      ? {
          codex: lastRound.codex,
          claude: lastRound.claude,
        }
      : null,
    rounds,
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

  const finalizationInputs = [];
  let finalized = null;

  while (true) {
    finalized = await finalizePlan({
      codexAgent,
      claudeAgent,
      context,
      userTask,
      workshopRounds: workshop.rounds,
      workshopUserInputs: [...workshop.userInputs, ...finalizationInputs],
      spinner,
      runDir: artifactsRoot,
    });

    if (finalized.ok) {
      break;
    }

    if (finalized.status !== "needs_user_input") {
      return { status: "error", error: finalized.error };
    }

    if (!process.stdin.isTTY && !ui?.compose) {
      return { status: "paused_for_user" };
    }

    const latestCodex = finalized.latest?.codex
      ? renderPlanSnapshot(finalized.latest.codex)
      : "(none)";
    const latestClaude = finalized.latest?.claude
      ? renderPlanSnapshot(finalized.latest.claude)
      : "(none)";
    const reply = await requestUserInput({
      ui,
      title: "You",
      instructions: [
        "최종 플랜 합의에 추가 사용자 판단이 필요합니다.",
        finalized.reason,
        "",
        "[Codex latest draft]",
        latestCodex,
        "",
        "[Claude latest draft]",
        latestClaude,
        "",
        "우선할 방향, 제외할 기능, 테스트/브랜치 전략 같은 제약을 입력하세요. /stop 은 종료합니다.",
      ].join("\n"),
      commands: [
        { name: "stop", description: "세션 종료" },
      ],
    });

    if (reply.type === "command" && reply.command === "stop") {
      return { status: "paused_for_user" };
    }

    if (reply.type !== "message" || !reply.text.trim()) {
      return { status: "paused_for_user" };
    }

    finalizationInputs.push({
      index: workshop.userInputs.length + finalizationInputs.length + 1,
      text: `[Final plan clarification]\n${reply.text.trim()}`,
    });
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
    rounds: finalized.rounds,
  });

  nextState = await saveState(workspace, nextState);

  return { status: "ok", state: nextState, plan: finalized.plan };
}
