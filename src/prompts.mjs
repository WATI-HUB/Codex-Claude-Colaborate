import { formatBulletList } from "./utils.mjs";

export const planningSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "task_understanding",
    "product_direction",
    "recommended_scope",
    "feature_ideas",
    "risks",
    "questions_for_user",
    "message_to_user",
    "message_to_other",
    "decision",
  ],
  properties: {
    task_understanding: { type: "string" },
    product_direction: { type: "string" },
    recommended_scope: { type: "string" },
    feature_ideas: {
      type: "array",
      items: { type: "string" },
    },
    risks: {
      type: "array",
      items: { type: "string" },
    },
    questions_for_user: {
      type: "array",
      items: { type: "string" },
    },
    message_to_user: { type: "string" },
    message_to_other: { type: "string" },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason", "proposed_brief"],
      properties: {
        status: {
          type: "string",
          enum: ["continue", "ready_for_implementation", "needs_user_input"],
        },
        reason: { type: "string" },
        proposed_brief: { type: "string" },
      },
    },
  },
};

export const debateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "task_understanding",
    "position_summary",
    "plan",
    "tradeoffs",
    "message_to_other",
    "decision",
  ],
  properties: {
    task_understanding: { type: "string" },
    position_summary: { type: "string" },
    plan: {
      type: "array",
      items: { type: "string" },
    },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
    },
    message_to_other: { type: "string" },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["status", "winner", "reason", "shared_plan", "needs_user_input"],
      properties: {
        status: {
          type: "string",
          enum: ["agree", "continue", "needs_user_input"],
        },
        winner: {
          type: "string",
          enum: ["codex", "claude", "none", "undecided"],
        },
        reason: { type: "string" },
        shared_plan: { type: "string" },
        needs_user_input: { type: "string" },
      },
    },
  },
};

export const verificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "findings", "message_to_other"],
  properties: {
    status: {
      type: "string",
      enum: ["approve", "changes_requested", "needs_user_input"],
    },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "issue", "suggested_fix"],
        properties: {
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          file: { type: "string" },
          issue: { type: "string" },
          suggested_fix: { type: "string" },
        },
      },
    },
    message_to_other: { type: "string" },
  },
};

export function debateSystemPrompt(agentName, otherAgentName) {
  return [
    `You are ${agentName}, one of two senior software engineers in a local debate loop.`,
    `The other engineer is ${otherAgentName}.`,
    "",
    "Rules:",
    "- No flattery, praise, cheerleading, or ego management.",
    "- Be direct, technical, and evidence-based.",
    "- Critique weak ideas clearly, but converge fast when persuaded.",
    "- Do not invent repository facts that are not in the provided context.",
    "- The program is not allowed to choose the winner.",
    `- You and ${otherAgentName} must explicitly converge on who should implement next.`,
    "- Choose a winner based on the stronger implementation plan for this exact task, not model loyalty.",
    "- If the task is unsafe or underspecified, request user input instead of bluffing.",
    "- Return JSON only.",
  ].join("\n");
}

export function buildWorkspaceBlock(context) {
  return [
    `Workspace: ${context.workspace}`,
    `Generated at: ${context.generatedAt}`,
    `Git repo: ${context.inGitRepo ? "yes" : "no"}`,
    `Git branch: ${context.gitBranch || "(none)"}`,
    "",
    "Git status:",
    context.gitStatus || "(none)",
    "",
    "Git diff stat:",
    context.gitDiffStat || "(none)",
    "",
    "File tree snapshot:",
    context.fileTree || "(empty)",
    "",
    "Important files:",
    formatBulletList(context.importantFiles),
    "",
    "Important file snippets:",
    context.importantSnippets || "(none)",
  ].join("\n");
}

export function buildPlanningPrompt({
  phaseName,
  agentName,
  otherAgentName,
  userTask,
  context,
  transcript,
  userContributions,
}) {
  return [
    `Phase: ${phaseName}`,
    `You are ${agentName}. The other agent is ${otherAgentName}.`,
    "",
    "This phase is early product and implementation planning.",
    "Do not implement yet.",
    "The human user is actively participating in this discussion.",
    "",
    "User request / brief:",
    userTask,
    "",
    buildWorkspaceBlock(context),
    "",
    transcript
      ? ["Planning transcript so far:", transcript, ""].join("\n")
      : "Planning transcript so far:\n(none)\n",
    userContributions
      ? ["Direct user contributions so far:", userContributions, ""].join("\n")
      : "Direct user contributions so far:\n(none)\n",
    "Output contract:",
    "- JSON only.",
    "- Suggest concrete feature ideas, scope boundaries, and risks.",
    "- Ask only focused questions that materially change implementation scope.",
    "- `message_to_user` should be written directly to the user.",
    "- `message_to_other` should be written directly to the other engineer.",
    "- Set `decision.status=ready_for_implementation` only if the scope is clear enough to start implementation debate.",
    "- Set `decision.status=needs_user_input` if the next step depends on a user preference or product choice.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDebatePrompt({
  phaseName,
  agentName,
  otherAgentName,
  userTask,
  context,
  transcript,
  extraGuidance,
  allowNoneWinner = false,
}) {
  const winnerGuidance = allowNoneWinner
    ? [
        '- `decision.winner` must be exactly one of: "codex", "claude", or "none".',
        '- Use `winner=none` only when both agents agree no more implementation is needed.',
      ]
    : [
        '- `decision.winner` must be exactly "codex" or "claude" — one of you must implement.',
        '- Do NOT use "none" or "undecided" as winner in this phase.',
      ];

  return [
    `Phase: ${phaseName}`,
    `You are ${agentName}. The other agent is ${otherAgentName}.`,
    "",
    "User task:",
    userTask,
    "",
    extraGuidance
      ? ["Additional guidance:", extraGuidance, ""].join("\n")
      : "",
    buildWorkspaceBlock(context),
    "",
    transcript
      ? ["Debate transcript so far:", transcript, ""].join("\n")
      : "Debate transcript so far:\n(none)\n",
    "Output contract:",
    "- JSON only.",
    "- `decision.status=agree` only when you think both agents can now proceed with the same winner and same plan.",
    ...winnerGuidance,
    "- Use `needs_user_input` only when the user must clarify a hidden constraint or tie-break an unresolved disagreement.",
    "- `message_to_other` should be written as if you are talking directly to the other engineer.",
    '- CRITICAL: Both agents must pick the SAME winner value to reach consensus.',
    '- Read the transcript carefully. If the other agent already picked a winner in a previous round, match their pick to converge.',
    '- Do NOT "politely concede" by switching to the opposite of what the other agent chose — this creates an infinite flip-flop.',
    '- If no transcript exists yet, volunteer yourself as winner. If the other agent already volunteered, accept their choice.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildImplementationPrompt({
  winnerName,
  agreedPlan,
  userTask,
  context,
  transcript,
}) {
  return [
    `You are ${winnerName}. Both agents already agreed that you should implement next.`,
    "",
    "Primary objective:",
    userTask,
    "",
    "Agreed plan:",
    agreedPlan,
    "",
    "Debate transcript:",
    transcript || "(none)",
    "",
    buildWorkspaceBlock(context),
    "",
    "Implementation rules:",
    "- Make the smallest correct set of changes that satisfies the agreed plan.",
    "- Prefer integrating with existing patterns over introducing novelty.",
    "- Run relevant tests or checks if they exist and if they are reasonable for the task.",
    "- If repo facts force a deviation from the agreed plan, adapt pragmatically and explain why.",
    "- Finish with a concise summary of changes, tests run, and remaining risks.",
  ].join("\n");
}

export function buildVerificationPrompt({
  verifierName,
  implementerName,
  userTask,
  context,
  transcript,
  implementationSummary,
  diffFocus,
}) {
  const changedFiles = diffFocus.changedFiles.length
    ? diffFocus.changedFiles.join("\n")
    : "(unable to detect changed files)";

  return [
    `You are ${verifierName}. ${implementerName} has implemented the current step.`,
    "",
    "User task:",
    userTask,
    "",
    "Implementation summary from implementer:",
    implementationSummary || "(none)",
    "",
    "Debate transcript:",
    transcript || "(none)",
    "",
    "Changed files focus:",
    changedFiles,
    "",
    "Diff stat:",
    diffFocus.diffStat || "(none)",
    "",
    "Diff details:",
    diffFocus.diffPatch || "(none)",
    "",
    buildWorkspaceBlock(context),
    "",
    "Verification rules:",
    "- Inspect the actual workspace state, not just the plan.",
    "- Focus on correctness, regressions, missing edge cases, and missing tests.",
    "- No flattery or softening language.",
    "- Approve only if the current state is good enough to stop.",
    "- Return JSON only.",
  ].join("\n");
}

export function renderPlanningTranscript(rounds, userInputs = []) {
  const sections = [];

  for (const round of rounds) {
    sections.push(
      [
        `Planning Round ${round.round}`,
        `[Codex to user] ${round.codex.message_to_user}`,
        `[Codex to Claude] ${round.codex.message_to_other}`,
        `[Codex scope] ${round.codex.recommended_scope}`,
        `[Codex decision] ${round.codex.decision.status} / ${round.codex.decision.reason}`,
        `[Claude to user] ${round.claude.message_to_user}`,
        `[Claude to Codex] ${round.claude.message_to_other}`,
        `[Claude scope] ${round.claude.recommended_scope}`,
        `[Claude decision] ${round.claude.decision.status} / ${round.claude.decision.reason}`,
      ].join("\n"),
    );
  }

  for (const entry of userInputs) {
    sections.push(`User Contribution ${entry.index}\n${entry.text}`);
  }

  return sections.length ? sections.join("\n\n") : "(none)";
}

export function renderTranscript(rounds) {
  if (!rounds.length) {
    return "(none)";
  }
  return rounds
    .map((round) => {
      return [
        `Round ${round.round}`,
        `[Codex] ${round.codex.message_to_other}`,
        `[Codex decision] ${round.codex.decision.status} / ${round.codex.decision.winner} / ${round.codex.decision.reason}`,
        `[Claude] ${round.claude.message_to_other}`,
        `[Claude decision] ${round.claude.decision.status} / ${round.claude.decision.winner} / ${round.claude.decision.reason}`,
      ].join("\n");
    })
    .join("\n\n");
}

export const planFinalizationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "features",
    "test_command",
    "lint_command",
    "git_strategy",
    "decision",
  ],
  properties: {
    summary: { type: "string" },
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "description", "acceptance_criteria", "estimated_complexity"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" },
          },
          estimated_complexity: {
            type: "string",
            enum: ["small", "medium", "large"],
          },
        },
      },
    },
    test_command: { type: "string" },
    lint_command: { type: "string" },
    git_strategy: {
      type: "object",
      additionalProperties: false,
      required: ["base_branch", "branch_prefix"],
      properties: {
        base_branch: { type: "string" },
        branch_prefix: { type: "string" },
      },
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason"],
      properties: {
        status: {
          type: "string",
          enum: ["agree", "needs_user_input", "continue"],
        },
        reason: { type: "string" },
      },
    },
  },
};

export const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "findings", "message"],
  properties: {
    status: {
      type: "string",
      enum: ["approve", "request_changes", "escalate"],
    },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "issue", "suggested_fix"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          file: { type: "string" },
          issue: { type: "string" },
          suggested_fix: { type: "string" },
        },
      },
    },
    message: { type: "string" },
  },
};

export function validatePlanFinalizationShape(out) {
  return (
    out &&
    typeof out.summary === "string" &&
    Array.isArray(out.features) &&
    typeof out.test_command === "string" &&
    typeof out.lint_command === "string" &&
    out.git_strategy &&
    typeof out.git_strategy.base_branch === "string" &&
    typeof out.git_strategy.branch_prefix === "string" &&
    out.decision &&
    typeof out.decision.status === "string"
  );
}

export function validateReviewShape(out) {
  return (
    out &&
    typeof out.status === "string" &&
    typeof out.summary === "string" &&
    Array.isArray(out.findings) &&
    typeof out.message === "string"
  );
}

export function buildPlanFinalizationPrompt({
  agentName,
  otherAgentName,
  userTask,
  context,
  transcript,
  userContributions,
}) {
  return [
    `Phase: plan-finalization`,
    `You are ${agentName}. The other agent is ${otherAgentName}.`,
    "",
    "두 에이전트가 합의한 기획을 최종 구조화된 플랜으로 변환합니다.",
    "기능을 작은 단위로 잘라서 features 배열에 배치하세요. 각 feature는 독립적으로 구현/테스트/커밋 가능해야 합니다.",
    "",
    "User task:",
    userTask,
    "",
    buildWorkspaceBlock(context),
    "",
    transcript ? `Planning transcript:\n${transcript}\n` : "",
    userContributions ? `User contributions:\n${userContributions}\n` : "",
    "Output contract:",
    "- JSON only.",
    "- features: 각 항목은 id (feature-001 형식), name, description, acceptance_criteria(테스트 가능한 조건), estimated_complexity(small|medium|large).",
    "- test_command/lint_command: 워크스페이스에서 실제로 실행 가능한 명령. 없으면 'true' 사용.",
    "- git_strategy: base_branch(예: main), branch_prefix(예: feature/).",
    "- decision.status=agree 면 최종 확정. needs_user_input 이면 사용자 확인 필요.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFeatureDebatePrompt({
  agentName,
  otherAgentName,
  feature,
  featurePlan,
  context,
  transcript,
}) {
  return [
    `Phase: feature-debate (${feature.id})`,
    `You are ${agentName}. The other agent is ${otherAgentName}.`,
    "",
    `Feature: ${feature.name}`,
    `Description: ${feature.description}`,
    "Acceptance criteria:",
    formatBulletList(feature.acceptanceCriteria || []),
    "",
    featurePlan ? `Feature plan document:\n${featurePlan}\n` : "",
    buildWorkspaceBlock(context),
    "",
    transcript ? `Debate transcript so far:\n${transcript}\n` : "Debate transcript so far:\n(none)\n",
    "Output contract:",
    "- JSON only following the debateSchema.",
    "- 토큰 절약: 짧고 구체적으로. 합의 가능하면 첫 라운드에서 winner 지정.",
    '- decision.winner는 "codex" 또는 "claude" 중 하나여야 함.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFeatureImplementationPrompt({
  winnerName,
  feature,
  featurePlan,
  agreedPlan,
  context,
  testCommand,
  lintCommand,
  previousFailure,
}) {
  return [
    `You are ${winnerName}. 아래 feature를 구현합니다.`,
    "",
    `Feature: ${feature.name} (${feature.id})`,
    `Description: ${feature.description}`,
    "Acceptance criteria:",
    formatBulletList(feature.acceptanceCriteria || []),
    "",
    featurePlan ? `Feature plan document:\n${featurePlan}\n` : "",
    `Agreed plan:\n${agreedPlan}\n`,
    buildWorkspaceBlock(context),
    "",
    previousFailure ? `Previous failure to fix:\n${previousFailure}\n` : "",
    "Implementation rules:",
    "- 최소 변경으로 acceptance criteria 충족.",
    `- 구현 후 \`${testCommand}\` 통과 필수.`,
    `- 구현 후 \`${lintCommand}\` 통과 필수.`,
    "- 다른 feature 영역은 건드리지 말 것.",
    "- 끝에 변경 요약을 출력.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReviewPrompt({
  reviewerName,
  implementerName,
  feature,
  context,
  diffFocus,
  testOutput,
  lintOutput,
  implementationSummary,
}) {
  return [
    `You are ${reviewerName}. ${implementerName}가 feature "${feature.id}"를 구현했습니다.`,
    "",
    `Feature: ${feature.name}`,
    `Description: ${feature.description}`,
    "Acceptance criteria:",
    formatBulletList(feature.acceptanceCriteria || []),
    "",
    implementationSummary ? `Implementer summary:\n${implementationSummary}\n` : "",
    `Diff stat:\n${(diffFocus.diffStat || "").slice(0, 2000)}\n`,
    `Diff:\n${(diffFocus.diffPatch || "").slice(0, 8000)}\n`,
    testOutput ? `Test output:\n${testOutput}\n` : "",
    lintOutput ? `Lint output:\n${lintOutput}\n` : "",
    buildWorkspaceBlock({ ...context, fileContents: [] }),
    "",
    "Review rules:",
    "- JSON only.",
    "- status=approve 면 추가 작업 없음.",
    "- status=request_changes 면 findings에 구체적 수정 요청.",
    "- status=escalate 면 사용자 호출 필요.",
    "- 테스트가 통과했고 acceptance criteria 만족하면 approve.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTestFailureGuidance({ command, exitCode, stdout, stderr }) {
  return [
    `명령 실패: ${command} (exit ${exitCode})`,
    "",
    "STDOUT:",
    (stdout || "").slice(-3000),
    "",
    "STDERR:",
    (stderr || "").slice(-3000),
    "",
    "이 실패를 해결하는 최소 변경을 적용하세요.",
  ].join("\n");
}

export function renderPlanSummaryMarkdown(planResult, userTask) {
  const lines = [
    "# Plan",
    "",
    `**Task**: ${userTask}`,
    "",
    `## Summary`,
    planResult.summary || "(none)",
    "",
    `## Git Strategy`,
    `- Base branch: \`${planResult.git_strategy.base_branch}\``,
    `- Branch prefix: \`${planResult.git_strategy.branch_prefix}\``,
    "",
    `## Commands`,
    `- Test: \`${planResult.test_command}\``,
    `- Lint: \`${planResult.lint_command}\``,
    "",
    `## Features`,
  ];
  for (const feature of planResult.features) {
    lines.push(
      "",
      `### ${feature.id} — ${feature.name} (${feature.estimated_complexity})`,
      "",
      feature.description || "",
      "",
      "**Acceptance criteria**:",
      ...(feature.acceptance_criteria || []).map((c) => `- ${c}`),
    );
  }
  return lines.join("\n") + "\n";
}

export function renderFeaturePlanMarkdown(feature) {
  return [
    `# ${feature.id} — ${feature.name}`,
    "",
    `**Complexity**: ${feature.complexity || feature.estimated_complexity || "medium"}`,
    "",
    `## Description`,
    feature.description || "",
    "",
    `## Acceptance Criteria`,
    ...(feature.acceptanceCriteria || feature.acceptance_criteria || []).map((c) => `- ${c}`),
    "",
  ].join("\n");
}

export function buildRepairGuidance(verificationResult) {
  const findingLines = verificationResult.findings.length
    ? verificationResult.findings
        .map((finding, index) => {
          const filePart = finding.file ? ` [${finding.file}]` : "";
          return `${index + 1}. (${finding.severity})${filePart} ${finding.issue} -> ${finding.suggested_fix}`;
        })
        .join("\n")
    : "(no findings)";

  return [
    "Verification result from the opposing agent:",
    `Status: ${verificationResult.status}`,
    `Summary: ${verificationResult.summary}`,
    `Message to other: ${verificationResult.message_to_other}`,
    "Findings:",
    findingLines,
    "",
    "Decide whether the current state is acceptable or whether another implementation pass is needed.",
  ].join("\n");
}
