import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { sectionColor, bold, dim } from "../core/terminal.mjs";

function printSummary(state) {
  console.log(`\n${sectionColor("=== Plan Ready ===")}`);
  if (state.task) {
    console.log(`${bold("Task:")} ${state.task}`);
  }
  if (state.testCommand) {
    console.log(`${bold("Test:")} ${state.testCommand}`);
  }
  if (state.lintCommand) {
    console.log(`${bold("Lint:")} ${state.lintCommand}`);
  }

  const features = state.plan?.features ?? state.features ?? [];
  if (features.length > 0) {
    console.log(`\n${bold("Features:")}`);
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const complexity = f.complexity ? dim(`[${f.complexity}]`) : "";
      const name = f.name ?? f.id ?? `feature-${i + 1}`;
      const id = f.id && f.id !== name ? dim(`(${f.id})`) : "";
      console.log(`  ${i + 1}. ${name} ${id} ${complexity}`.trimEnd());
    }
  }

  console.log(
    `\n${dim("Enter/y=진행  q=중단  e <지시>=수정 요청")}`,
  );
}

async function readOneLine(prompt) {
  const rl = readline.createInterface({ input, output });

  const swallowEio = (err) => {
    if (!err) return;
    const code = err.code ?? "";
    const msg = String(err.message ?? err);
    if (code === "EIO" || msg.includes("EIO")) {
      try { rl.close(); } catch {}
      return;
    }
    throw err;
  };

  rl.on("error", swallowEio);

  try {
    return await rl.question(prompt);
  } catch (err) {
    if (
      err &&
      (err.code === "ERR_USE_AFTER_CLOSE" ||
        err.code === "EIO" ||
        String(err.message ?? "").includes("EIO"))
    ) {
      return null;
    }
    throw err;
  } finally {
    try { rl.close(); } catch {}
  }
}

/**
 * Show plan summary and prompt for user approval.
 *
 * @param {object} state  Current pipeline state (after planning phase).
 * @returns {Promise<{action:"go"}|{action:"abort"}|{action:"revise",note:string}>}
 */
export async function showPlanGate(state) {
  // Non-TTY: auto-approve
  if (!process.stdin.isTTY) {
    return { action: "go" };
  }

  printSummary(state);

  const noop = () => {};
  process.on("SIGTTOU", noop);
  process.on("SIGTTIN", noop);

  try {
    while (true) {
      let line;
      try {
        line = await readOneLine("plan> ");
      } catch (err) {
        // EIO or closed — treat as go
        return { action: "go" };
      }

      // null means EIO / closed
      if (line === null) {
        return { action: "go" };
      }

      const trimmed = line.trim();

      if (trimmed === "" || /^y(es)?$/i.test(trimmed)) {
        return { action: "go" };
      }

      if (/^(q(uit)?|abort)$/i.test(trimmed)) {
        return { action: "abort" };
      }

      if (/^e\s+/i.test(trimmed)) {
        const note = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
        return { action: "revise", note };
      }

      console.log(dim('입력을 인식하지 못했습니다. Enter/y=진행  q=중단  e <지시>=수정 요청'));
    }
  } finally {
    process.off("SIGTTOU", noop);
    process.off("SIGTTIN", noop);
  }
}
