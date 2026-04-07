import os from "node:os";
import path from "node:path";
import {
  extractJson,
  pathExists,
  runCommand,
  runInteractiveCommand,
  runInteractiveLoginShell,
  runLoginShell,
} from "./utils.mjs";

const homeDir = os.homedir();

function codexStatusLooksLoggedIn(text) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("logged in") && !normalized.includes("not logged in");
}

async function runClaudeCommand(bin, args, options = {}) {
  const preferredDirectPath =
    bin && bin.includes("/") ? bin : null;
  const directCommand = preferredDirectPath || bin || "claude";
  const loginShellCommand = path.basename(directCommand) || "claude";

  try {
    return await runLoginShell([loginShellCommand, ...args], options);
  } catch (loginShellError) {
    try {
      return await runCommand(directCommand, args, options);
    } catch (directError) {
      if (directError.result) {
        throw directError;
      }
      throw loginShellError;
    }
  }
}

async function runClaudeInteractiveCommand(bin, args, options = {}) {
  const preferredDirectPath =
    bin && bin.includes("/") ? bin : null;
  const directCommand = preferredDirectPath || bin || "claude";
  const loginShellCommand = path.basename(directCommand) || "claude";

  try {
    return await runInteractiveLoginShell([loginShellCommand, ...args], options);
  } catch (loginShellError) {
    try {
      return await runInteractiveCommand(directCommand, args, options);
    } catch (directError) {
      if (directError.result) {
        throw directError;
      }
      throw loginShellError;
    }
  }
}

export async function getCodexAuthStatus({ bin, workspace }) {
  const artifactPath = path.join(homeDir, ".codex/auth.json");
  const artifactFound = await pathExists(artifactPath);
  const statusResult = await runCommand(bin || "codex", ["login", "status"], {
    cwd: workspace,
    allowFailure: true,
    timeoutMs: 10_000,
  });
  const combinedOutput = `${statusResult.stdout}\n${statusResult.stderr}`;

  return {
    artifactFound,
    artifactPath,
    loggedIn:
      statusResult.exitCode === 0 &&
      codexStatusLooksLoggedIn(combinedOutput),
    statusResult,
  };
}

export async function getClaudeAuthStatus({ bin, workspace }) {
  const artifactPath = path.join(homeDir, ".claude.json");
  const artifactFound = await pathExists(artifactPath);
  const statusResult = await runClaudeCommand(bin, ["auth", "status"], {
    cwd: workspace,
    allowFailure: true,
    timeoutMs: 10_000,
  });
  const parsed = extractJson(statusResult.stdout);

  return {
    artifactFound,
    artifactPath,
    loggedIn: parsed?.loggedIn === true,
    parsed,
    statusResult,
  };
}

export async function getAuthStatus({ codexBin, claudeBin, workspace }) {
  const [codex, claude] = await Promise.all([
    getCodexAuthStatus({ bin: codexBin, workspace }),
    getClaudeAuthStatus({ bin: claudeBin, workspace }),
  ]);

  return { codex, claude };
}

function ensureInteractiveTerminal(agentName) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return;
  }

  throw new Error(
    `${agentName} 로그인이 필요하지만 현재 터미널이 비대화형이라 자동 로그인 절차를 시작할 수 없습니다.`,
  );
}

export async function ensureAuthenticated({
  codexBin,
  claudeBin,
  workspace,
  onMessage = () => {},
}) {
  let codex = await getCodexAuthStatus({ bin: codexBin, workspace });
  if (!codex.loggedIn) {
    ensureInteractiveTerminal("Codex");
    onMessage("Codex 로그인이 필요합니다. 로그인 절차를 시작합니다.");
    await runInteractiveCommand(codexBin || "codex", ["login"], {
      cwd: workspace,
    });
    codex = await getCodexAuthStatus({ bin: codexBin, workspace });
    if (!codex.loggedIn) {
      throw new Error("Codex 로그인 확인에 실패했습니다.");
    }
  }

  let claude = await getClaudeAuthStatus({ bin: claudeBin, workspace });
  if (!claude.loggedIn) {
    ensureInteractiveTerminal("Claude");
    onMessage("Claude 로그인이 필요합니다. `claude auth login`을 시작합니다.");
    await runClaudeInteractiveCommand(claudeBin, ["auth", "login"], {
      cwd: workspace,
    });
    claude = await getClaudeAuthStatus({ bin: claudeBin, workspace });
    if (!claude.loggedIn) {
      throw new Error(
        "Claude 로그인 확인에 실패했습니다. 구독 토큰 방식이면 `claude setup-token`이 필요할 수 있습니다.",
      );
    }
  }

  return { codex, claude };
}
