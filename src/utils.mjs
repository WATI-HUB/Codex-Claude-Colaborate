import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sectionColor } from "./terminal.mjs";

export function nowStamp() {
  const iso = new Date().toISOString();
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export function printSection(title) {
  console.log(`\n${sectionColor("=== " + title + " ===")}`);
}

export function truncate(text, maxChars = 8000) {
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export function stripAnsi(text) {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    "",
  );
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractJson(text) {
  const trimmed = text.trim();
  const direct = safeJsonParse(trimmed);
  if (direct !== null) {
    return direct;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const fenced = safeJsonParse(fenceMatch[1].trim());
    if (fenced !== null) {
      return fenced;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = safeJsonParse(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    const parsed = safeJsonParse(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export async function commandExists(command) {
  const result = await runCommand("bash", ["-lc", `command -v ${command}`], {
    timeoutMs: 10_000,
    allowFailure: true,
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    input,
    timeoutMs = 10 * 60 * 1000,
    allowFailure = false,
    env = {},
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const result = {
        command,
        args,
        cwd,
        exitCode: code ?? -1,
        signal: signal ?? null,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
      };

      if (!allowFailure && result.exitCode !== 0) {
        const error = new Error(
          `Command failed (${result.exitCode}): ${command} ${args.join(" ")}\n${truncate(result.stderr || result.stdout, 2000)}`,
        );
        error.result = result;
        reject(error);
        return;
      }

      resolve(result);
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function shellEscape(value) {
  if (value === "") {
    return "''";
  }
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export async function runLoginShell(commandParts, options = {}) {
  const commandString = commandParts.map((part) => shellEscape(part)).join(" ");
  return runCommand("zsh", ["-lic", commandString], options);
}

export function formatBulletList(items) {
  if (!items || items.length === 0) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

export function summarizeFailure(error) {
  if (!error) {
    return "Unknown error";
  }
  if (error.result) {
    return truncate(
      `${error.message}\n\nSTDERR:\n${error.result.stderr}\n\nSTDOUT:\n${error.result.stdout}`,
      4000,
    );
  }
  return truncate(String(error.stack || error.message || error), 4000);
}
