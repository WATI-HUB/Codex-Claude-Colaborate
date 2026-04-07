import fs from "node:fs/promises";
import path from "node:path";
import { ClaudeAgent, CodexAgent } from "./agents.mjs";
import {
  collectDiffFocus,
  collectWorkspaceContext,
  diffSnapshots,
  snapshotWorkspace,
} from "./context.mjs";
import {
  buildPlanningPrompt,
  buildDebatePrompt,
  buildImplementationPrompt,
  buildRepairGuidance,
  buildVerificationPrompt,
  planningSchema,
  debateSchema,
  debateSystemPrompt,
  renderPlanningTranscript,
  renderTranscript,
  verificationSchema,
} from "./prompts.mjs";
import {
  codex as codexColor,
  claude as claudeColor,
  agentColor,
  success,
  dim,
  bold,
  Spinner,
  withSpinner,
} from "./terminal.mjs";
import {
  ensureDir,
  nowStamp,
  printSection,
  truncate,
  writeJson,
  writeText,
} from "./utils.mjs";

export function validatePlanningShape(agentOutput) {
  return (
    agentOutput &&
    typeof agentOutput.task_understanding === "string" &&
    typeof agentOutput.product_direction === "string" &&
    typeof agentOutput.recommended_scope === "string" &&
    Array.isArray(agentOutput.feature_ideas) &&
    Array.isArray(agentOutput.risks) &&
    Array.isArray(agentOutput.questions_for_user) &&
    typeof agentOutput.message_to_user === "string" &&
    typeof agentOutput.message_to_other === "string" &&
    agentOutput.decision &&
    typeof agentOutput.decision.status === "string" &&
    typeof agentOutput.decision.reason === "string"
  );
}

export function validateDebateShape(agentOutput) {
  return (
    agentOutput &&
    typeof agentOutput.task_understanding === "string" &&
    typeof agentOutput.position_summary === "string" &&
    Array.isArray(agentOutput.plan) &&
    Array.isArray(agentOutput.tradeoffs) &&
    typeof agentOutput.message_to_other === "string" &&
    agentOutput.decision &&
    typeof agentOutput.decision.status === "string" &&
    typeof agentOutput.decision.winner === "string"
  );
}

export function validateVerificationShape(agentOutput) {
  return (
    agentOutput &&
    typeof agentOutput.status === "string" &&
    typeof agentOutput.summary === "string" &&
    Array.isArray(agentOutput.findings) &&
    typeof agentOutput.message_to_other === "string"
  );
}

export function debateConsensus(codex, claude, allowNoneWinner) {
  if (codex.decision.status !== "agree" || claude.decision.status !== "agree") {
    return null;
  }

  const validWinners = allowNoneWinner
    ? ["codex", "claude", "none"]
    : ["codex", "claude"];

  // If both agree on the same valid winner, consensus reached
  if (
    codex.decision.winner === claude.decision.winner &&
    validWinners.includes(codex.decision.winner)
  ) {
    return {
      winner: codex.decision.winner,
      sharedPlan:
        codex.decision.shared_plan || claude.decision.shared_plan || codex.position_summary,
      reason: `${codex.decision.reason} / ${claude.decision.reason}`,
    };
  }

  const codexValid = validWinners.includes(codex.decision.winner);
  const claudeValid = validWinners.includes(claude.decision.winner);

  // One valid, one invalid: use the valid one
  if (codexValid && !claudeValid) {
    return {
      winner: codex.decision.winner,
      sharedPlan:
        codex.decision.shared_plan || claude.decision.shared_plan || codex.position_summary,
      reason: `${codex.decision.reason} / ${claude.decision.reason} (winner from Codex; Claude agreed but picked invalid winner "${claude.decision.winner}")`,
    };
  }
  if (claudeValid && !codexValid) {
    return {
      winner: claude.decision.winner,
      sharedPlan:
        claude.decision.shared_plan || codex.decision.shared_plan || claude.position_summary,
      reason: `${codex.decision.reason} / ${claude.decision.reason} (winner from Claude; Codex agreed but picked invalid winner "${codex.decision.winner}")`,
    };
  }

  // Both valid but different (cross-concession): each agent volunteered the other.
  // Deterministic tie-break: pick the agent that volunteered itself (self-nomination wins).
  // If neither self-nominated, pick codex as deterministic default.
  if (codexValid && claudeValid && codex.decision.winner !== claude.decision.winner) {
    const codexSelfNominated = codex.decision.winner === "codex";
    const claudeSelfNominated = claude.decision.winner === "claude";
    const winner = codexSelfNominated ? "codex"
      : claudeSelfNominated ? "claude"
      : "codex";
    return {
      winner,
      sharedPlan:
        codex.decision.shared_plan || claude.decision.shared_plan || codex.position_summary,
      reason: `${codex.decision.reason} / ${claude.decision.reason} (cross-concession resolved: ${winner})`,
    };
  }

  return null;
}

export function bothNeedUserInput(codex, claude) {
  return (
    codex.decision.status === "needs_user_input" &&
    claude.decision.status === "needs_user_input"
  );
}

export async function requestUserInput({
  ui,
  title,
  instructions,
  commands = [],
}) {
  if (ui?.compose) {
    return ui.compose({
      title,
      instructions,
      commands,
    });
  }

  // 비대화형 환경(e2e, 파이프 등): stdin이 TTY가 아니면 자동 skip
  if (!process.stdin.isTTY) {
    const skipCmd = commands.find((c) => c.name === "skip");
    if (skipCmd) return { type: "command", command: "skip" };
    const proceedCmd = commands.find((c) => c.name === "proceed");
    if (proceedCmd) return { type: "command", command: "proceed" };
    return { type: "message", text: "" };
  }

  const helpText = commands.length
    ? ` ${commands.map((command) => `/${command.name}`).join(", ")}`
    : "";
  const answer = await (async () => {
    const readline = await import("node:readline/promises");
    const { stdin, stdout } = await import("node:process");
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const value = await rl.question(`${instructions}${helpText}\n> `);
      return value.trim();
    } finally {
      rl.close();
    }
  })();

  const matched = commands.find((command) => answer === `/${command.name}`);
  if (matched) {
    return {
      type: "command",
      command: matched.name,
    };
  }

  return {
    type: "message",
    text: answer,
  };
}

export function formatElapsed(startMs) {
  const elapsed = Date.now() - startMs;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(1)}s`;
}

export function printDebateRound(roundNumber, codex, claude) {
  console.log(`\n${bold("[Round " + roundNumber + "]")}`);
  console.log(`${codexColor("Codex ->")} ${codex.message_to_other}`);
  console.log(
    dim(`  decision: ${codex.decision.status} / ${codex.decision.winner} / ${codex.decision.reason}`),
  );
  console.log(`${claudeColor("Claude ->")} ${claude.message_to_other}`);
  console.log(
    dim(`  decision: ${claude.decision.status} / ${claude.decision.winner} / ${claude.decision.reason}`),
  );
}

export function printPlanningRound(roundNumber, codex, claude) {
  console.log(`\n${bold("[Planning Round " + roundNumber + "]")}`);
  console.log(`${codexColor("Codex")} to user: ${codex.message_to_user}`);
  if (codex.feature_ideas.length) {
    console.log(`  ${codexColor("feature ideas:")} ${codex.feature_ideas.join(" | ")}`);
  }
  if (codex.questions_for_user.length) {
    console.log(`  ${codexColor("questions:")} ${codex.questions_for_user.join(" | ")}`);
  }
  console.log(`${claudeColor("Claude")} to user: ${claude.message_to_user}`);
  if (claude.feature_ideas.length) {
    console.log(`  ${claudeColor("feature ideas:")} ${claude.feature_ideas.join(" | ")}`);
  }
  if (claude.questions_for_user.length) {
    console.log(`  ${claudeColor("questions:")} ${claude.questions_for_user.join(" | ")}`);
  }
}

export async function runPlanningWorkshop({
  codexAgent,
  claudeAgent,
  context,
  userTask,
  runDir,
  maxRounds,
  ui,
  spinner,
}) {
  const rounds = [];
  const userInputs = [];
  let userContributionIndex = 1;
  let round = 1;

  while (true) {
    const transcript = renderPlanningTranscript(rounds, userInputs);
    const userContributions = userInputs.length
      ? userInputs.map((entry) => `User ${entry.index}: ${entry.text}`).join("\n")
      : "(none)";

    const codexPrompt = buildPlanningPrompt({
      phaseName: "planning-workshop",
      agentName: "Codex",
      otherAgentName: "Claude",
      userTask,
      context,
      transcript,
      userContributions,
    });
    const claudePrompt = buildPlanningPrompt({
      phaseName: "planning-workshop",
      agentName: "Claude",
      otherAgentName: "Codex",
      userTask,
      context,
      transcript,
      userContributions,
    });

    const codexResult = await withSpinner(
      spinner,
      `${codexColor("Codex")} is thinking...`,
      () => codexAgent.runStructured({
        name: `planning-round-${String(round).padStart(2, "0")}`,
        prompt: codexPrompt,
        schema: planningSchema,
      }),
    );

    const claudeResult = await withSpinner(
      spinner,
      `${claudeColor("Claude")} is thinking...`,
      () => claudeAgent.runStructured({
        name: `planning-round-${String(round).padStart(2, "0")}`,
        prompt: claudePrompt,
        schema: planningSchema,
        systemPrompt: debateSystemPrompt("Claude", "Codex"),
        disableTools: true,
      }),
    );

    if (!codexResult.ok || !claudeResult.ok) {
      return {
        status: "error",
        rounds,
        userInputs,
        error: {
          codex: codexResult.ok ? null : codexResult.error,
          claude: claudeResult.ok ? null : claudeResult.error,
        },
      };
    }

    if (!validatePlanningShape(codexResult.parsed) || !validatePlanningShape(claudeResult.parsed)) {
      return {
        status: "error",
        rounds,
        userInputs,
        error: {
          codex: "Invalid planning response shape",
          claude: "Invalid planning response shape",
        },
      };
    }

    rounds.push({
      round,
      codex: codexResult.parsed,
      claude: claudeResult.parsed,
    });

    await writeJson(path.join(runDir, "planning-workshop.rounds.json"), {
      rounds,
      userInputs,
    });

    printPlanningRound(round, codexResult.parsed, claudeResult.parsed);

    const blankAction =
      round >= maxRounds ? "현재 내용으로 구현 토론으로 진행" : "다음 기획 라운드로 진행";
    const userReply = await requestUserInput({
      ui,
      title: "You",
      instructions: `기획 토론에 참여하세요. 의견, 제약, 기능 아이디어를 멀티라인으로 입력한 뒤 /send 를 입력하세요. /proceed 면 구현 토론으로 진행합니다. /skip 은 ${blankAction}. /stop 은 종료합니다.`,
      commands: [
        { name: "proceed", description: "구현 토론으로 진행" },
        { name: "skip", description: blankAction },
        { name: "stop", description: "세션 종료" },
      ],
    });

    if (userReply.type === "command" && userReply.command === "stop") {
      return {
        status: "paused_for_user",
        rounds,
        userInputs,
      };
    }

    if (userReply.type === "command" && userReply.command === "proceed") {
      return {
        status: "ready",
        rounds,
        userInputs,
      };
    }

    if (userReply.type === "message" && userReply.text) {
      userInputs.push({
        index: userContributionIndex,
        text: userReply.text,
      });
      userContributionIndex += 1;
      round += 1;
      continue;
    }

    if (userReply.type === "command" && userReply.command === "skip" && round >= maxRounds) {
      return {
        status: "ready",
        rounds,
        userInputs,
      };
    }

    if (userReply.type === "command" && userReply.command === "skip") {
      round += 1;
      continue;
    }

    if (round >= maxRounds) {
      return {
        status: "ready",
        rounds,
        userInputs,
      };
    }

    round += 1;
  }
}

export async function runDebateLoop({
  codexAgent,
  claudeAgent,
  context,
  userTask,
  runDir,
  phaseName,
  maxRounds,
  extraGuidance = "",
  allowNoneWinner = false,
  spinner,
}) {
  const rounds = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const transcript = renderTranscript(rounds);
    const codexPrompt = buildDebatePrompt({
      phaseName,
      agentName: "Codex",
      otherAgentName: "Claude",
      userTask,
      context,
      transcript,
      extraGuidance,
      allowNoneWinner,
    });
    const claudePrompt = buildDebatePrompt({
      phaseName,
      agentName: "Claude",
      otherAgentName: "Codex",
      userTask,
      context,
      transcript,
      extraGuidance,
      allowNoneWinner,
    });

    const codexResult = await withSpinner(
      spinner,
      `${codexColor("Codex")} is thinking...`,
      () => codexAgent.runStructured({
        name: `${phaseName}-round-${String(round).padStart(2, "0")}`,
        prompt: codexPrompt,
        schema: debateSchema,
      }),
    );

    const claudeResult = await withSpinner(
      spinner,
      `${claudeColor("Claude")} is thinking...`,
      () => claudeAgent.runStructured({
        name: `${phaseName}-round-${String(round).padStart(2, "0")}`,
        prompt: claudePrompt,
        schema: debateSchema,
        systemPrompt: debateSystemPrompt("Claude", "Codex"),
        disableTools: true,
      }),
    );

    if (!codexResult.ok || !claudeResult.ok) {
      return {
        status: "error",
        rounds,
        error: {
          codex: codexResult.ok ? null : codexResult.error,
          claude: claudeResult.ok ? null : claudeResult.error,
        },
      };
    }

    if (!validateDebateShape(codexResult.parsed) || !validateDebateShape(claudeResult.parsed)) {
      return {
        status: "error",
        rounds,
        error: {
          codex: "Invalid structured debate response shape",
          claude: "Invalid structured debate response shape",
        },
      };
    }

    rounds.push({
      round,
      codex: codexResult.parsed,
      claude: claudeResult.parsed,
    });

    await writeJson(path.join(runDir, `${phaseName}.rounds.json`), rounds);
    printDebateRound(round, codexResult.parsed, claudeResult.parsed);

    const consensus = debateConsensus(
      codexResult.parsed,
      claudeResult.parsed,
      allowNoneWinner,
    );
    if (consensus) {
      return {
        status: "consensus",
        rounds,
        consensus,
      };
    }

    if (bothNeedUserInput(codexResult.parsed, claudeResult.parsed)) {
      return {
        status: "needs_user_input",
        rounds,
      };
    }
  }

  return {
    status: "needs_user_input",
    rounds,
  };
}

export async function runVerification({
  verifier,
  verifierName,
  implementerName,
  userTask,
  context,
  transcript,
  implementationSummary,
  diffFocus,
  spinner,
}) {
  const prompt = buildVerificationPrompt({
    verifierName,
    implementerName,
    userTask,
    context,
    transcript,
    implementationSummary,
    diffFocus,
  });

  const result = await withSpinner(
    spinner,
    `${agentColor(verifierName, verifierName)} is verifying...`,
    () => verifier.runStructured({
      name: `verification-${implementerName.toLowerCase()}`,
      prompt,
      schema: verificationSchema,
      systemPrompt: debateSystemPrompt(verifierName, implementerName),
      disableTools: verifierName === "Claude",
    }),
  );

  if (!result.ok || !validateVerificationShape(result.parsed)) {
    return {
      ok: false,
      error: result.ok ? "Invalid verification JSON shape" : result.error,
    };
  }

  return {
    ok: true,
    parsed: result.parsed,
  };
}

export async function runOrchestrator({
  workspace,
  userTask,
  codexBin,
  claudeBin,
  codexModel,
  claudeModel,
  debateRounds,
  planningRounds,
  repairRounds,
  maxCycles,
  skipWorkshop = false,
  dangerousClaudePermissions = false,
  ui = null,
}) {
  const artifactsRoot = path.join(workspace, ".agent-debate");
  const runId = nowStamp();
  const runDir = path.join(artifactsRoot, "runs", runId);
  await ensureDir(runDir);

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

  await writeJson(path.join(runDir, "session.json"), {
    startedAt: new Date().toISOString(),
    workspace,
    userTask,
    codexBin,
    claudeBin,
    codexModel,
    claudeModel,
    planningRounds,
    debateRounds,
    repairRounds,
    maxCycles,
    skipWorkshop,
  });

  const spinner = new Spinner();
  const sessionStart = Date.now();

  if (ui?.section) {
    ui.section("Workspace Context");
  } else {
    printSection("Workspace Context");
  }
  let context = await collectWorkspaceContext(workspace);
  await writeJson(path.join(runDir, "workspace-context.json"), context);
  console.log(`Workspace: ${workspace}`);
  console.log(`Git repo: ${context.inGitRepo ? "yes" : "no"}`);
  console.log(`Artifacts: ${runDir}`);

  let guidance = "";

  if (!skipWorkshop) {
    if (ui?.section) {
      ui.section("Planning Workshop");
    } else {
      printSection("Planning Workshop");
    }
    const workshop = await runPlanningWorkshop({
      codexAgent,
      claudeAgent,
      context,
      userTask,
      runDir,
      maxRounds: planningRounds,
      ui,
      spinner,
    });

    if (workshop.status === "error") {
      throw new Error(
        `Planning workshop failed.\nCodex: ${workshop.error.codex || "ok"}\nClaude: ${workshop.error.claude || "ok"}`,
      );
    }

    if (workshop.status === "paused_for_user") {
      return {
        status: "paused_for_user",
        runDir,
      };
    }

    const planningTranscript = renderPlanningTranscript(workshop.rounds, workshop.userInputs);
    guidance = [
      "Collaborative planning workshop transcript:",
      truncate(planningTranscript, 16_000),
      "",
      "Use the user's direct contributions as high-priority product constraints.",
    ].join("\n");

    await writeText(path.join(runDir, "planning-workshop.summary.txt"), guidance);
  }

  let initialDebate;
  while (true) {
    if (ui?.section) {
      ui.section("Initial Debate");
    } else {
      printSection("Initial Debate");
    }
    initialDebate = await runDebateLoop({
      codexAgent,
      claudeAgent,
      context,
      userTask,
      runDir,
      phaseName: "initial-debate",
      maxRounds: debateRounds,
      extraGuidance: guidance,
      allowNoneWinner: false,
      spinner,
    });

    if (initialDebate.status === "consensus") {
      break;
    }

    if (initialDebate.status === "error") {
      throw new Error(
        `Initial debate failed.\nCodex: ${initialDebate.error.codex || "ok"}\nClaude: ${initialDebate.error.claude || "ok"}`,
      );
    }

    const tieBreaker = await requestUserInput({
      ui,
      title: "You",
      instructions:
        "두 에이전트가 합의하지 못했습니다. 추가 지시나 tie-breaker를 멀티라인으로 입력한 뒤 /send 하세요. /stop 으로 종료할 수 있습니다.",
      commands: [{ name: "stop", description: "세션 종료" }],
    });
    if (tieBreaker.type === "command" && tieBreaker.command === "stop") {
      return {
        status: "paused_for_user",
        runDir,
      };
    }
    if (tieBreaker.type !== "message" || !tieBreaker.text) {
      return {
        status: "paused_for_user",
        runDir,
      };
    }
    guidance = guidance
      ? `${guidance}\n\nUser tie-breaker:\n${tieBreaker.text}`
      : `User tie-breaker:\n${tieBreaker.text}`;
  }

  const transcript = renderTranscript(initialDebate.rounds);
  const initialWinner = initialDebate.consensus.winner;

  if (ui?.section) {
    ui.section("Consensus");
  } else {
    printSection("Consensus");
  }
  console.log(`${success("Winner:")} ${agentColor(initialWinner, initialWinner)}`);
  console.log(`${success("Plan:")} ${initialDebate.consensus.sharedPlan}`);

  let cycle = 1;
  let currentWinner = initialWinner;
  let currentPlan = initialDebate.consensus.sharedPlan;
  let currentTranscript = transcript;

  while (cycle <= maxCycles) {
    if (ui?.section) {
      ui.section(`Implementation Cycle ${cycle}`);
    } else {
      printSection(`Implementation Cycle ${cycle}`);
    }
    const beforeSnapshot = await snapshotWorkspace(workspace);

    const implementationPrompt = buildImplementationPrompt({
      winnerName: currentWinner === "codex" ? "Codex" : "Claude",
      agreedPlan: currentPlan,
      userTask,
      context,
      transcript: currentTranscript,
    });

    const winnerLabel = currentWinner === "codex" ? "Codex" : "Claude";
    const implementationResult = await withSpinner(
      spinner,
      `${agentColor(winnerLabel, winnerLabel)} is implementing...`,
      () => currentWinner === "codex"
        ? codexAgent.implement({
            name: `implementation-cycle-${cycle}`,
            prompt: implementationPrompt,
          })
        : claudeAgent.implement({
            name: `implementation-cycle-${cycle}`,
            prompt: implementationPrompt,
            systemPrompt: debateSystemPrompt("Claude", "Codex"),
          }),
    );

    if (!implementationResult.ok) {
      throw new Error(`Implementation by ${currentWinner} failed:\n${implementationResult.error}`);
    }

    await writeText(
      path.join(runDir, `implementation-cycle-${cycle}.summary.txt`),
      implementationResult.summary,
    );

    context = await collectWorkspaceContext(workspace);
    await writeJson(path.join(runDir, `workspace-context-cycle-${cycle}.json`), context);

    const afterSnapshot = await snapshotWorkspace(workspace);
    const snapshotDiff = diffSnapshots(beforeSnapshot, afterSnapshot);
    const diffFocus = await collectDiffFocus(workspace, snapshotDiff);
    await writeJson(path.join(runDir, `diff-focus-cycle-${cycle}.json`), diffFocus);

    if (ui?.section) {
      ui.section(`Verification Cycle ${cycle}`);
    } else {
      printSection(`Verification Cycle ${cycle}`);
    }
    const verification =
      currentWinner === "codex"
        ? await runVerification({
            verifier: claudeAgent,
            verifierName: "Claude",
            implementerName: "Codex",
            userTask,
            context,
            transcript: currentTranscript,
            implementationSummary: implementationResult.summary,
            diffFocus,
            spinner,
          })
        : await runVerification({
            verifier: codexAgent,
            verifierName: "Codex",
            implementerName: "Claude",
            userTask,
            context,
            transcript: currentTranscript,
            implementationSummary: implementationResult.summary,
            diffFocus,
            spinner,
          });

    if (!verification.ok) {
      throw new Error(`Verification failed: ${verification.error}`);
    }

    await writeJson(path.join(runDir, `verification-cycle-${cycle}.json`), verification.parsed);
    const verifierStatus = verification.parsed.status === "approve" ? success(verification.parsed.status) : bold(verification.parsed.status);
    console.log(`Verifier status: ${verifierStatus}`);
    console.log(`Verifier summary: ${verification.parsed.summary}`);

    if (ui?.section) {
      ui.section(`Repair Debate ${cycle}`);
    } else {
      printSection(`Repair Debate ${cycle}`);
    }
    const repairGuidance = buildRepairGuidance(verification.parsed);
    let repairDebate;
    let repairExtra = repairGuidance;

    while (true) {
      repairDebate = await runDebateLoop({
        codexAgent,
        claudeAgent,
        context,
        userTask,
        runDir,
        phaseName: `repair-debate-cycle-${cycle}`,
        maxRounds: repairRounds,
        extraGuidance: repairExtra,
        allowNoneWinner: true,
        spinner,
      });

      if (repairDebate.status === "consensus") {
        break;
      }

      if (repairDebate.status === "error") {
        throw new Error(
          `Repair debate failed.\nCodex: ${repairDebate.error.codex || "ok"}\nClaude: ${repairDebate.error.claude || "ok"}`,
        );
      }

      const tieBreaker = await requestUserInput({
        ui,
        title: "You",
        instructions:
          "수정 방향 토론에서 합의하지 못했습니다. 추가 지시를 멀티라인으로 입력한 뒤 /send 하세요. /stop 으로 종료할 수 있습니다.",
        commands: [{ name: "stop", description: "세션 종료" }],
      });
      if (tieBreaker.type === "command" && tieBreaker.command === "stop") {
        return {
          status: "paused_for_user",
          runDir,
        };
      }
      if (tieBreaker.type !== "message" || !tieBreaker.text) {
        return {
          status: "paused_for_user",
          runDir,
        };
      }
      repairExtra = `${repairExtra}\n\nUser tie-breaker:\n${tieBreaker.text}`;
    }

    currentTranscript = `${currentTranscript}\n\n${renderTranscript(repairDebate.rounds)}`;

    if (repairDebate.consensus.winner === "none") {
      await writeJson(path.join(runDir, "final-result.json"), {
        status: "completed",
        finalWinner: currentWinner,
        verification: verification.parsed,
        finalDecision: repairDebate.consensus,
      });

      const elapsed = formatElapsed(sessionStart);
      console.log("\n" + success("최종 합의: 추가 수정 없이 종료합니다.") + " " + dim("(총 " + elapsed + ")"));
      return {
        status: "completed",
        runDir,
        finalWinner: currentWinner,
        verification: verification.parsed,
      };
    }

    currentWinner = repairDebate.consensus.winner;
    currentPlan = repairDebate.consensus.sharedPlan;
    cycle += 1;
  }

  return {
    status: "max_cycles_reached",
    runDir,
  };
}
