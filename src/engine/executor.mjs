import path from "node:path";
import {
  collectDiffFocus,
  collectWorkspaceContext,
  diffSnapshots,
  snapshotWorkspace,
} from "../core/context.mjs";
import {
  buildFeatureDebatePrompt,
  buildFeatureImplementationPrompt,
  buildReviewPrompt,
  buildTestFailureGuidance,
  debateSchema,
  debateSystemPrompt,
  reviewSchema,
  validateReviewShape,
} from "./prompts.mjs";
import {
  debateConsensus,
  requestUserInput,
  validateDebateShape,
} from "./orchestrator.mjs";
import {
  Spinner,
  agentColor,
  bold,
  claude as claudeColor,
  codex as codexColor,
  dim,
  success,
  withSpinner,
} from "../core/terminal.mjs";
import {
  ensureDir,
  readText,
  runCommand,
  truncate,
  writeJson,
  writeText,
} from "../core/utils.mjs";
import {
  advanceFeature,
  currentFeature,
  saveState,
  updateFeature,
} from "../core/state.mjs";
import {
  commitAll,
  createBranch,
  isGitRepo,
} from "./git-ops.mjs";

const COMPLEXITY_ROUNDS = { small: 1, medium: 2, large: 3 };
const MAX_REVIEW_CYCLES = 3;
const MAX_REPAIR_ATTEMPTS = 5;

function maxDebateRounds(complexity) {
  return COMPLEXITY_ROUNDS[complexity] || 2;
}

async function runFeatureDebate({
  codexAgent,
  claudeAgent,
  feature,
  featurePlan,
  context,
  spinner,
  runDir,
}) {
  const rounds = [];
  const max = maxDebateRounds(feature.complexity);

  for (let round = 1; round <= max; round += 1) {
    const transcriptText = rounds.length
      ? rounds
          .map(
            (r) =>
              `Round ${r.round}\n[Codex] ${r.codex.message_to_other}\n[Claude] ${r.claude.message_to_other}`,
          )
          .join("\n\n")
      : "";

    const codexPrompt = buildFeatureDebatePrompt({
      agentName: "Codex",
      otherAgentName: "Claude",
      feature,
      featurePlan,
      context,
      transcript: transcriptText,
    });
    const claudePrompt = buildFeatureDebatePrompt({
      agentName: "Claude",
      otherAgentName: "Codex",
      feature,
      featurePlan,
      context,
      transcript: transcriptText,
    });

    const codexResult = await withSpinner(
      spinner,
      `${codexColor("Codex")} debating ${feature.id}...`,
      () => codexAgent.runStructured({
        name: `${feature.id}-debate-r${round}`,
        prompt: codexPrompt,
        schema: debateSchema,
      }),
    );
    const claudeResult = await withSpinner(
      spinner,
      `${claudeColor("Claude")} debating ${feature.id}...`,
      () => claudeAgent.runStructured({
        name: `${feature.id}-debate-r${round}`,
        prompt: claudePrompt,
        schema: debateSchema,
        systemPrompt: debateSystemPrompt("Claude", "Codex"),
        disableTools: true,
      }),
    );

    if (!codexResult.ok || !claudeResult.ok) {
      return { status: "error", error: codexResult.error || claudeResult.error };
    }
    if (
      !validateDebateShape(codexResult.parsed) ||
      !validateDebateShape(claudeResult.parsed)
    ) {
      return { status: "error", error: "Invalid debate shape" };
    }

    rounds.push({ round, codex: codexResult.parsed, claude: claudeResult.parsed });
    await writeJson(path.join(runDir, `${feature.id}.debate.json`), rounds);
    console.log(`\n${bold(`[${feature.id} Round ${round}]`)}`);
    console.log(`${codexColor("Codex ->")} ${codexResult.parsed.message_to_other}`);
    console.log(`${claudeColor("Claude ->")} ${claudeResult.parsed.message_to_other}`);

    const consensus = debateConsensus(codexResult.parsed, claudeResult.parsed, false);
    if (consensus) {
      return { status: "consensus", rounds, consensus };
    }
  }

  // 합의 안 됨 → 강제 codex
  const last = rounds[rounds.length - 1];
  return {
    status: "consensus",
    rounds,
    consensus: {
      winner: "codex",
      sharedPlan: last?.codex.position_summary || "Codex 진행",
      reason: "max rounds reached, default to codex",
    },
  };
}

async function runFeatureReview({
  reviewer,
  reviewerName,
  implementerName,
  feature,
  context,
  diffFocus,
  testOutput,
  lintOutput,
  implementationSummary,
  spinner,
}) {
  const prompt = buildReviewPrompt({
    reviewerName,
    implementerName,
    feature,
    context,
    diffFocus,
    testOutput,
    lintOutput,
    implementationSummary,
  });

  const result = await withSpinner(
    spinner,
    `${agentColor(reviewerName, reviewerName)} reviewing ${feature.id}...`,
    () => reviewer.runStructured({
      name: `${feature.id}-review-${reviewerName.toLowerCase()}`,
      prompt,
      schema: reviewSchema,
      systemPrompt: debateSystemPrompt(reviewerName, implementerName),
      disableTools: reviewerName === "Claude",
    }),
  );

  if (!result.ok || !validateReviewShape(result.parsed)) {
    return { ok: false, error: result.error || "invalid review shape" };
  }
  return { ok: true, parsed: result.parsed };
}

async function runShellCommand(workspace, command) {
  if (!command || command === "true") {
    return { exitCode: 0, stdout: "", stderr: "", skipped: true };
  }
  const result = await runCommand("bash", ["-lc", command], {
    cwd: workspace,
    allowFailure: true,
    timeoutMs: 10 * 60 * 1000,
  });
  return result;
}

async function executeFeature({
  workspace,
  state,
  feature,
  codexAgent,
  claudeAgent,
  ui,
  spinner,
  runDir,
}) {
  const featurePlan = await readText(path.join(workspace, feature.planFile)).catch(() => "");

  // git branch
  const gitAvailable = await isGitRepo(workspace);
  if (gitAvailable) {
    try {
      await createBranch(workspace, feature.branch, state.gitStrategy.baseBranch);
    } catch (error) {
      console.log(dim(`branch 생성 실패 (계속 진행): ${error.message}`));
    }
  }

  let context = await collectWorkspaceContext(workspace);
  const debateResult = await runFeatureDebate({
    codexAgent,
    claudeAgent,
    feature,
    featurePlan,
    context,
    spinner,
    runDir,
  });
  if (debateResult.status === "error") {
    return { status: "error", error: debateResult.error };
  }

  let { winner, sharedPlan } = debateResult.consensus;
  let previousFailure = "";
  let reviewCycle = 0;
  let repairAttempts = 0;
  let lastImplementationSummary = "";
  let lastTestOutput = "";
  let lastLintOutput = "";

  while (reviewCycle < MAX_REVIEW_CYCLES && repairAttempts < MAX_REPAIR_ATTEMPTS) {
    // implement → test → lint loop
    while (true) {
      if (repairAttempts >= MAX_REPAIR_ATTEMPTS) break;
      const beforeSnapshot = await snapshotWorkspace(workspace);
      const winnerLabel = winner === "codex" ? "Codex" : "Claude";
      const implPrompt = buildFeatureImplementationPrompt({
        winnerName: winnerLabel,
        feature,
        featurePlan,
        agreedPlan: sharedPlan,
        context,
        testCommand: state.testCommand,
        lintCommand: state.lintCommand,
        previousFailure,
      });

      const implResult = await withSpinner(
        spinner,
        `${agentColor(winnerLabel, winnerLabel)} implementing ${feature.id}...`,
        () => winner === "codex"
          ? codexAgent.implement({
              name: `${feature.id}-impl-${repairAttempts + 1}`,
              prompt: implPrompt,
            })
          : claudeAgent.implement({
              name: `${feature.id}-impl-${repairAttempts + 1}`,
              prompt: implPrompt,
              systemPrompt: debateSystemPrompt("Claude", "Codex"),
            }),
      );

      if (!implResult.ok) {
        return { status: "error", error: `Implementation failed: ${implResult.error}` };
      }
      lastImplementationSummary = implResult.summary || "";
      repairAttempts += 1;

      context = await collectWorkspaceContext(workspace);

      // test
      const testResult = await runShellCommand(workspace, state.testCommand);
      lastTestOutput = truncate(`${testResult.stdout}\n${testResult.stderr}`, 4000);
      if (testResult.exitCode !== 0 && !testResult.skipped) {
        previousFailure = buildTestFailureGuidance({
          command: state.testCommand,
          exitCode: testResult.exitCode,
          stdout: testResult.stdout,
          stderr: testResult.stderr,
        });
        console.log(dim(`테스트 실패 → 재구현 (시도 ${repairAttempts}/${MAX_REPAIR_ATTEMPTS})`));
        continue;
      }

      // lint
      const lintResult = await runShellCommand(workspace, state.lintCommand);
      lastLintOutput = truncate(`${lintResult.stdout}\n${lintResult.stderr}`, 4000);
      if (lintResult.exitCode !== 0 && !lintResult.skipped) {
        previousFailure = buildTestFailureGuidance({
          command: state.lintCommand,
          exitCode: lintResult.exitCode,
          stdout: lintResult.stdout,
          stderr: lintResult.stderr,
        });
        console.log(dim(`린트 실패 → 재구현 (시도 ${repairAttempts}/${MAX_REPAIR_ATTEMPTS})`));
        continue;
      }

      // both passed
      const afterSnapshot = await snapshotWorkspace(workspace);
      const snapshotDiff = diffSnapshots(beforeSnapshot, afterSnapshot);
      const diffFocus = await collectDiffFocus(workspace, snapshotDiff);

      // commit
      if (gitAvailable) {
        try {
          const commit = await commitAll(workspace, `feat(${feature.id}): ${feature.name}`);
          if (commit.ok) {
            console.log(success(`commit ${commit.sha.slice(0, 8)} 생성`));
            state = updateFeature(state, feature.id, {
              commits: [...feature.commits, commit.sha],
            });
            await saveState(workspace, state);
          }
        } catch (error) {
          console.log(dim(`commit 실패 (계속 진행): ${error.message}`));
        }
      }

      // review by both
      reviewCycle += 1;
      const codexReview = await runFeatureReview({
        reviewer: codexAgent,
        reviewerName: "Codex",
        implementerName: winner === "codex" ? "Codex" : "Claude",
        feature,
        context,
        diffFocus,
        testOutput: lastTestOutput,
        lintOutput: lastLintOutput,
        implementationSummary: lastImplementationSummary,
        spinner,
      });
      const claudeReview = await runFeatureReview({
        reviewer: claudeAgent,
        reviewerName: "Claude",
        implementerName: winner === "codex" ? "Codex" : "Claude",
        feature,
        context,
        diffFocus,
        testOutput: lastTestOutput,
        lintOutput: lastLintOutput,
        implementationSummary: lastImplementationSummary,
        spinner,
      });

      if (!codexReview.ok || !claudeReview.ok) {
        return { status: "error", error: codexReview.error || claudeReview.error };
      }

      console.log(`${codexColor("Codex review:")} ${codexReview.parsed.status} — ${codexReview.parsed.summary}`);
      console.log(`${claudeColor("Claude review:")} ${claudeReview.parsed.status} — ${claudeReview.parsed.summary}`);
      await writeJson(path.join(runDir, `${feature.id}.review-${reviewCycle}.json`), {
        codex: codexReview.parsed,
        claude: claudeReview.parsed,
      });

      const bothApprove =
        codexReview.parsed.status === "approve" && claudeReview.parsed.status === "approve";
      if (bothApprove) {
        return { status: "ok", state };
      }

      if (
        codexReview.parsed.status === "escalate" ||
        claudeReview.parsed.status === "escalate"
      ) {
        return await escalateToUser({ ui, feature, codexReview, claudeReview, state });
      }

      // request_changes — fold both findings into next implementation
      const findings = [
        ...(codexReview.parsed.findings || []).map((f) => `[Codex/${f.severity}] ${f.issue} → ${f.suggested_fix}`),
        ...(claudeReview.parsed.findings || []).map((f) => `[Claude/${f.severity}] ${f.issue} → ${f.suggested_fix}`),
      ];
      previousFailure = `리뷰 수정 요청:\n${findings.join("\n") || "(상세 없음)"}`;
      // 다시 implement loop로 (winner 유지)
      break;
    }
  }

  // 한도 초과 → 사용자 호출
  return await escalateToUser({
    ui,
    feature,
    state,
    reason: `Review/repair 한도 초과 (review=${reviewCycle}, repair=${repairAttempts})`,
  });
}

async function escalateToUser({ ui, feature, state, reason, codexReview, claudeReview }) {
  const messageParts = [
    `Feature ${feature.id} (${feature.name}) — 사용자 개입 필요`,
  ];
  if (reason) messageParts.push(reason);
  if (codexReview) messageParts.push(`Codex: ${codexReview.parsed.summary}`);
  if (claudeReview) messageParts.push(`Claude: ${claudeReview.parsed.summary}`);

  const reply = await requestUserInput({
    ui,
    title: "You",
    instructions: `${messageParts.join("\n")}\n\n지시를 입력하세요. /skip 은 이 feature를 실패로 표시하고 다음으로, /stop 은 종료.`,
    commands: [
      { name: "skip", description: "이 feature 실패로 표시" },
      { name: "stop", description: "세션 종료" },
    ],
  });

  if (reply.type === "command" && reply.command === "stop") {
    return { status: "paused_for_user", state };
  }
  if (reply.type === "command" && reply.command === "skip") {
    return { status: "failed", state };
  }
  // 사용자가 메시지 입력 → 호출자가 다음 시도에 반영하도록 일단 failed로 보내고 재시도는 추후 확장
  return { status: "paused_for_user", state, userMessage: reply.text };
}

export async function runExecutor({
  workspace,
  state,
  codexAgent,
  claudeAgent,
  ui,
}) {
  const spinner = new Spinner();
  const runDir = path.join(workspace, ".agent-debate", "runs", "executor");
  await ensureDir(runDir);

  let currentState = state;

  while (currentState.phase === "executing" && currentFeature(currentState)) {
    const feature = currentFeature(currentState);
    if (ui?.section) ui.section(`Feature ${feature.id} — ${feature.name}`);
    else console.log(`\n=== Feature ${feature.id} — ${feature.name} ===`);

    currentState = updateFeature(currentState, feature.id, { status: "in_progress" });
    currentState = await saveState(workspace, currentState);

    const result = await executeFeature({
      workspace,
      state: currentState,
      feature,
      codexAgent,
      claudeAgent,
      ui,
      spinner,
      runDir,
    });

    if (result.status === "paused_for_user") {
      return { status: "paused_for_user", state: result.state || currentState };
    }
    if (result.status === "error") {
      currentState = updateFeature(currentState, feature.id, { status: "failed" });
      await saveState(workspace, currentState);
      return { status: "error", error: result.error, state: currentState };
    }

    const finalStatus = result.status === "ok" ? "completed" : "failed";
    currentState = updateFeature(result.state || currentState, feature.id, {
      status: finalStatus,
    });
    currentState = advanceFeature(currentState);
    currentState = await saveState(workspace, currentState);
  }

  return { status: "completed", state: currentState };
}
