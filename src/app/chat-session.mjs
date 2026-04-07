import { getAuthStatus } from "../core/auth.mjs";
import { TerminalChatUI } from "./chat-ui.mjs";
import { runFullPipeline } from "../engine/pipeline.mjs";
import { commandExists, pathExists } from "../core/utils.mjs";

async function showDoctor(ui, options) {
  const codexBinFound =
    (await pathExists(options.codexBin)) || (await commandExists("codex"));
  const claudeBinFound =
    (await pathExists(options.claudeBin)) || (await commandExists("claude"));
  const authStatus =
    codexBinFound && claudeBinFound
      ? await getAuthStatus({
          codexBin: options.codexBin,
          claudeBin: options.claudeBin,
          workspace: options.workspace,
        })
      : null;

  ui.section("Doctor");
  ui.info(
    [
      `Workspace: ${options.workspace}`,
      `Codex binary: ${codexBinFound ? options.codexBin : "not found"}`,
      `Claude binary: ${claudeBinFound ? options.claudeBin : "not found"}`,
      `Codex login artifact: ${
        authStatus ? (authStatus.codex.artifactFound ? "found" : "missing") : "unknown"
      }`,
      `Claude login artifact: ${
        authStatus ? (authStatus.claude.artifactFound ? "found" : "missing") : "unknown"
      }`,
      `Codex login status: ${
        authStatus ? (authStatus.codex.loggedIn ? "logged in" : "not logged in") : "unknown"
      }`,
      `Claude login shell auth: ${
        authStatus ? (authStatus.claude.loggedIn ? "logged in" : "not logged in") : "unknown"
      }`,
    ].join("\n"),
  );
}

export async function startChatSession(options) {
  const ui = new TerminalChatUI();

  try {
    ui.section("Debate Chat");
    ui.info(
      [
        "터미널 채팅 모드입니다.",
        "긴 지시사항을 여러 줄로 입력한 뒤 /send 를 입력하세요.",
        "기본적으로 먼저 기획 워크숍이 시작되고, 그 다음 구현 토론으로 넘어갑니다.",
      ].join("\n"),
    );

    while (true) {
      const initial = await ui.compose({
        title: "You",
        instructions:
          "새 요청을 입력하세요. 멀티라인 입력 후 /send 로 시작합니다. /doctor 는 환경 점검, /exit 는 종료입니다.",
        commands: [
          { name: "doctor", description: "환경 점검" },
          { name: "exit", description: "세션 종료" },
        ],
      });

      if (initial.type === "command" && initial.command === "exit") {
        return {
          status: "exited",
        };
      }

      if (initial.type === "command" && initial.command === "doctor") {
        await showDoctor(ui, options);
        continue;
      }

      if (initial.type !== "message" || !initial.text.trim()) {
        continue;
      }

      const result = await runFullPipeline({
        workspace: options.workspace,
        userTask: initial.text.trim(),
        codexBin: options.codexBin,
        claudeBin: options.claudeBin,
        codexModel: options.codexModel,
        claudeModel: options.claudeModel,
        planningRounds: options.planningRounds,
        dangerousClaudePermissions: options.dangerousClaudePermissions,
        ui,
      });

      ui.section("Run Result");
      ui.info(JSON.stringify(result, null, 2));
    }
  } finally {
    ui.close();
  }
}
