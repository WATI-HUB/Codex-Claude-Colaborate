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

export class CodexAgent {
  constructor({ bin, workspace, runDir, model }) {
    this.bin = bin;
    this.workspace = workspace;
    this.runDir = runDir;
    this.model = model;
  }

  async runStructured({ name, prompt, schema, sandbox = "read-only", timeoutMs = 20 * 60 * 1000 }) {
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
      sandbox,
      "--skip-git-repo-check",
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
    ];

    if (this.model) {
      args.push("-m", this.model);
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

  async implement({ name, prompt, timeoutMs = 45 * 60 * 1000 }) {
    const phaseDir = path.join(this.runDir, "codex");
    await ensureDir(phaseDir);
    const outputPath = path.join(phaseDir, `${name}.last-message.txt`);
    const promptPath = path.join(phaseDir, `${name}.prompt.txt`);
    const stdoutPath = path.join(phaseDir, `${name}.stdout.log`);
    const stderrPath = path.join(phaseDir, `${name}.stderr.log`);
    await writeText(promptPath, prompt);

    const args = [
      "exec",
      "-C",
      this.workspace,
      "--skip-git-repo-check",
      "--full-auto",
      "-o",
      outputPath,
    ];

    if (this.model) {
      args.push("-m", this.model);
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
  constructor({ bin, workspace, runDir, model, dangerousSkipPermissions = false }) {
    this.bin = bin;
    this.workspace = workspace;
    this.runDir = runDir;
    this.model = model;
    this.dangerousSkipPermissions = dangerousSkipPermissions;
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
    permissionMode = "default",
    timeoutMs = 20 * 60 * 1000,
  }) {
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
      permissionMode,
    ];

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    args.push("--json-schema", schemaArg(schema));

    if (disableTools) {
      args.push("--tools", "");
    }

    if (this.model) {
      args.push("--model", this.model);
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
    timeoutMs = 45 * 60 * 1000,
  }) {
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
      "dontAsk",
    ];

    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    if (this.dangerousSkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.model) {
      args.push("--model", this.model);
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
