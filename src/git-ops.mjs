import { runCommand } from "./utils.mjs";

async function git(workspace, args, { allowFailure = true } = {}) {
  return runCommand("git", args, {
    cwd: workspace,
    allowFailure,
    timeoutMs: 30_000,
  });
}

export async function isGitRepo(workspace) {
  const result = await git(workspace, ["rev-parse", "--show-toplevel"]);
  return result.exitCode === 0;
}

export async function currentBranch(workspace) {
  const result = await git(workspace, ["branch", "--show-current"]);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

export async function hasBranch(workspace, branch) {
  const result = await git(workspace, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return result.exitCode === 0;
}

export async function createBranch(workspace, branch, baseBranch) {
  if (await hasBranch(workspace, branch)) {
    return git(workspace, ["checkout", branch], { allowFailure: false });
  }
  if (baseBranch) {
    const baseExists = await hasBranch(workspace, baseBranch);
    if (baseExists) {
      return git(workspace, ["checkout", "-b", branch, baseBranch], {
        allowFailure: false,
      });
    }
  }
  return git(workspace, ["checkout", "-b", branch], { allowFailure: false });
}

export async function checkoutBranch(workspace, branch) {
  return git(workspace, ["checkout", branch], { allowFailure: false });
}

export async function stageAll(workspace) {
  return git(workspace, ["add", "-A"], { allowFailure: false });
}

export async function hasStagedChanges(workspace) {
  const result = await git(workspace, ["diff", "--cached", "--quiet"]);
  return result.exitCode !== 0;
}

export async function hasAnyChanges(workspace) {
  const result = await git(workspace, ["status", "--porcelain"]);
  return result.stdout.trim().length > 0;
}

export async function commitAll(workspace, message) {
  if (!(await hasAnyChanges(workspace))) {
    return { ok: false, reason: "no_changes" };
  }
  await stageAll(workspace);
  if (!(await hasStagedChanges(workspace))) {
    return { ok: false, reason: "no_staged_changes" };
  }
  const commit = await git(workspace, ["commit", "-m", message], {
    allowFailure: false,
  });
  const sha = await git(workspace, ["rev-parse", "HEAD"]);
  return {
    ok: true,
    sha: sha.stdout.trim(),
    stdout: commit.stdout,
  };
}

export async function recentCommits(workspace, limit = 5) {
  const result = await git(workspace, [
    "log",
    `-${limit}`,
    "--pretty=format:%h %s",
  ]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
