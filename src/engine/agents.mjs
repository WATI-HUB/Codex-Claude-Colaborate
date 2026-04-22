import path from "node:path";
import {
  ensureDir,
  extractJson,
  readText,
  runCommand,
  runLoginShell,
  summarizeFailure,
  writeJson,
  writeText,
} from "../core/utils.mjs";

function schemaArg(schema) {
  return JSON.stringify(schema);
}

const VALID_PHASES = new Set(["plan", "debate", "implement", "review"]);
const CODEX_STRUCTURED_SANDBOX_DEFAULT = "read-only";
const CODEX_IMPLEMENT_SANDBOX_DISPLAY = "full-auto";
const CLAUDE_STRUCTURED_PERMISSION_DEFAULT = "default";
const CLAUDE_IMPLEMENT_PERMISSION_DEFAULT = "dontAsk";

function resolvePhase(phase) {
  return phase && VALID_PHASES.has(phase) ? phase : null;
}

function pickPhase(map, phase, fallback) {
  const p = resolvePhase(phase);
  if (p && map && map[p] != null) return map[p];
  return fallback;
}

export class CodexAgent {
  constructor({
    bin,
    workspace,
    runDir,
    model,
    effort,
    sandbox,
    phaseModels,
    phaseEfforts,
    phaseSandboxes,
  }) {
    this.bin = bin;
    this.workspace = workspace;
    this.runDir = runDir;
    this.model = model;
    this.effort = effort;
    this.sandbox = sandbox;
    this.phaseModels = phaseModels || {};
    this.phaseEfforts = phaseEfforts || {};
    this.phaseSandboxes = phaseSandboxes || {};
  }

  resolveModel(phase) {
    return pickPhase(this.phaseModels, phase, this.model);
  }

  resolveEffort(phase) {
    return pickPhase(this.phaseEfforts, phase, this.effort);
  }

  resolveSandbox(phase, fallback) {
    return pickPhase(this.phaseSandboxes, phase, this.sandbox || fallback);
  }

  describeSandbox(phase) {
    const fallback =
      resolvePhase(phase) === "implement"
        ? null
        : CODEX_STRUCTURED_SANDBOX_DEFAULT;
    return this.resolveSandbox(phase, fallback) || CODEX_IMPLEMENT_SANDBOX_DISPLAY;
  }

  async runStructured({ name, prompt, schema, sandbox, phase, timeoutMs = 20 * 60 * 1000 }) {
    const resolvedSandbox =
      sandbox || this.resolveSandbox(phase, CODEX_STRUCTURED_SANDBOX_DEFAULT);
    const resolvedModel = this.resolveModel(phase);
    const resolvedEffort = this.resolveEffort(phase);
    const phaseDir = path.join(this.runDir, "codex");
    await ensureDir(phaseDir);

    const schemaPath = path.join(phaseDir, `${name}.schema.json`);
    const outputPath = path.join(phaseDir, `${name}.output.json`);
    const promptPath = path.join(phaseDir, `${name}.prompt.txt`);
    const stdoutPath = path.join(phaseDir, `${name}.stdout.log`);
    const stderrPath = path.join(phaseDir, `${name}.stderr.log`);

    await writeJson(schemaPath, schema);
    await writeText(promptPath, prompt);

    const args = [
      "exec",
      "-C",
      this.workspace,
      "-s",
      resolvedSandbox,
      "--skip-git-repo-check",
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
    ];

    if (resolvedModel) {
      args.push("-m", resolvedModel);
    }

    if (resolvedEffort) {
      args.push("-c", `model_reasoning_effort=${resolvedEffort}`);
    }

    try {
      const result = await runCommand(this.bin, args, {
        cwd: this.workspace,
        input: prompt,
        timeoutMs,
      });

      await writeText(stdoutPath, result.stdout);
      await writeText(stderrPath, result.stderr);

      const outputText = await readText(outputPath);
      const parsed = extractJson(outputText);
      if (!parsed) {
        const error = new Error(`Codex returned non-JSON structured output for ${name}`);
        error.result = result;
        throw error;
      }

      return {
        ok: true,
        parsed,
        stdout: result.stdout,
        stderr: result.stderr,
        outputText,
      };
    } catch (error) {
      await writeText(stdoutPath, error.result?.stdout || "");
      await writeText(stderrPath, error.result?.stderr || summarizeFailure(error));
      return {
        ok: false,
        error: summarizeFailure(error),
      };
    }
  }

  async implement({ name, prompt, phase = "implement", timeoutMs = 45 * 60 * 1000 }) {
    const phaseDir = path.join(this.runDir, "codex");
    await ensureDir(phaseDir);
    const outputPath = path.join(phaseDir, `${name}.last-message.txt`);
    const promptPath = path.join(phaseDir, `${name}.prompt.txt`);
    const stdoutPath = path.join(phaseDir, `${name}.stdout.log`);
    const stderrPath = path.join(phaseDir, `${name}.stderr.log`);
    await writeText(promptPath, prompt);

    const resolvedSandbox = this.resolveSandbox(phase, null);
    const resolvedModel = this.resolveModel(phase);
    const resolvedEffort = this.resolveEffort(phase);

    const args = [
      "exec",
      "-C",
      this.workspace,
      "--skip-git-repo-check",
    ];

    if (resolvedSandbox) {
      args.push("-s", resolvedSandbox, "--ask-for-approval", "never");
    } else {
      args.push("--full-auto");
    }

    args.push("-o", outputPath);

    if (resolvedModel) {
      args.push("-m", resolvedModel);
    }

    if (resolvedEffort) {
      args.push("-c", `model_reasoning_effort=${resolvedEffort}`);
    }

    try {
      const result = await runCommand(this.bin, args, {
        cwd: this.workspace,
        input: prompt,
        timeoutMs,
      });

      await writeText(stdoutPath, result.stdout);
      await writeText(stderrPath, result.stderr);

      const summary = await readText(outputPath);
      return {
        ok: true,
        summary,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      await writeText(stdoutPath, error.result?.stdout || "");
      await writeText(stderrPath, error.result?.stderr || summarizeFailure(error));
      return {
        ok: false,
        error: summarizeFailure(error),
      };
    }
  }
}

export class ClaudeAgent {
  constructor({
    bin,
    workspace,
    runDir,
    model,
    permission,
    phaseModels,
    phasePermissions,
    dangerousSkipPermissions = false,
  }) {
    this.bin = bin;
    this.workspace = workspace;
    this.runDir = runDir;
    this.model = model;
    this.permission = permission;
    this.phaseModels = phaseModels || {};
    this.phasePermissions = phasePermissions || {};
    this.dangerousSkipPermissions = dangerousSkipPermissions;
  }

  resolveModel(phase) {
    return pickPhase(this.phaseModels, phase, this.model);
  }

  resolvePermission(phase, fallback) {
    return pickPhase(this.phasePermissions, phase, this.permission || fallback);
  }

  describePermission(phase) {
    const fallback =
      resolvePhase(phase) === "implement"
        ? CLAUDE_IMPLEMENT_PERMISSION_DEFAULT
        : CLAUDE_STRUCTURED_PERMISSION_DEFAULT;
    return this.resolvePermission(phase, fallback);
  }

  async executeClaude(args, { cwd, timeoutMs, input }) {
    const preferredDirectPath =
      this.bin && this.bin.includes("/") ? this.bin : null;
    const directCommand = preferredDirectPath || this.bin || "claude";
    const loginShellCommand = path.basename(directCommand) || "claude";

    try {
      return await runLoginShell([loginShellCommand, ...args], {
        cwd,
        timeoutMs,
        input,
      });
    } catch (loginShellError) {
      try {
        return await runCommand(directCommand, args, {
          cwd,
          timeoutMs,
          input,
        });
      } catch (directError) {
        if (directError.result) {
          throw directError;
        }
        throw loginShellError;
      }
    }
  }

  async runStructured({
    name,
    prompt,
    schema,
    systemPrompt,
    disableTools = false,
    permissionMode,
    phase,
    timeoutMs = 20 * 60 * 1000,
  }) {
    const resolvedPermission =
      permissionMode || this.resolvePermission(phase, CLAUDE_STRUCTURED_PERMISSION_DEFAULT);
    const resolvedModel = this.resolveModel(phase);
    const phaseDir = path.join(this.runDir, "claude");
    await ensureDir(phaseDir);
    const promptPath = path.join(phaseDir, `${name}.prompt.txt`);
    const systemPromptPath = path.join(phaseDir, `${name}.system-prompt.txt`);
    const stdoutPath = path.join(phaseDir, `${name}.stdout.log`);
    const stderrPath = path.join(phaseDir, `${name}.stderr.log`);
    await writeText(promptPath, prompt);
    await writeText(systemPromptPath, systemPrompt || "");

    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      resolvedPermission,
    ];

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    args.push("--json-schema", schemaArg(schema));

    if (disableTools) {
      args.push("--tools", "");
    }

    if (resolvedModel) {
      args.push("--model", resolvedModel);
    }

    try {
      const result = await this.executeClaude(args, {
        cwd: this.workspace,
        timeoutMs,
        input: prompt,
      });

      await writeText(stdoutPath, result.stdout);
      await writeText(stderrPath, result.stderr);

      const parsedEnvelope = extractJson(result.stdout);
      const parsed =
        parsedEnvelope &&
        typeof parsedEnvelope === "object" &&
        parsedEnvelope.structured_output
          ? parsedEnvelope.structured_output
          : parsedEnvelope;
      if (!parsed) {
        const error = new Error(`Claude returned non-JSON structured output for ${name}`);
        error.result = result;
        throw error;
      }

      return {
        ok: true,
        parsed,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      await writeText(stdoutPath, error.result?.stdout || "");
      await writeText(stderrPath, error.result?.stderr || summarizeFailure(error));
      return {
        ok: false,
        error: summarizeFailure(error),
      };
    }
  }

  async implement({
    name,
    prompt,
    systemPrompt,
    phase = "implement",
    timeoutMs = 45 * 60 * 1000,
  }) {
    const resolvedPermission =
      this.resolvePermission(phase, CLAUDE_IMPLEMENT_PERMISSION_DEFAULT);
    const resolvedModel = this.resolveModel(phase);
    const phaseDir = path.join(this.runDir, "claude");
    await ensureDir(phaseDir);
    const promptPath = path.join(phaseDir, `${name}.prompt.txt`);
    const systemPromptPath = path.join(phaseDir, `${name}.system-prompt.txt`);
    const stdoutPath = path.join(phaseDir, `${name}.stdout.log`);
    const stderrPath = path.join(phaseDir, `${name}.stderr.log`);
    await writeText(promptPath, prompt);
    await writeText(systemPromptPath, systemPrompt || "");

    const args = [
      "-p",
      "--permission-mode",
      resolvedPermission,
    ];

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    if (this.dangerousSkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (resolvedModel) {
      args.push("--model", resolvedModel);
    }

    try {
      const result = await this.executeClaude(args, {
        cwd: this.workspace,
        timeoutMs,
        input: prompt,
      });

      await writeText(stdoutPath, result.stdout);
      await writeText(stderrPath, result.stderr);

      return {
        ok: true,
        summary: result.stdout.trim(),
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      await writeText(stdoutPath, error.result?.stdout || "");
      await writeText(stderrPath, error.result?.stderr || summarizeFailure(error));
      return {
        ok: false,
        error: summarizeFailure(error),
      };
    }
  }
}
