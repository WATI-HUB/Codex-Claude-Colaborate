import fs from "node:fs/promises";
import path from "node:path";
import { pathExists, runCommand, truncate } from "./utils.mjs";

const PRIORITY_FILE_NAMES = [
  "README.md",
  "README",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "Makefile",
];

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".agent-debate",
  ".next",
  "dist",
  "build",
  "coverage",
]);

async function walk(dirPath, basePath, out) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, absolutePath) || ".";

    if (entry.isDirectory()) {
      out.push(`${relativePath}/`);
      if (out.length >= 250) {
        return;
      }
      await walk(absolutePath, basePath, out);
      if (out.length >= 250) {
        return;
      }
      continue;
    }

    out.push(relativePath);
    if (out.length >= 250) {
      return;
    }
  }
}

async function collectImportantFiles(workspace) {
  const selected = [];

  for (const fileName of PRIORITY_FILE_NAMES) {
    const target = path.join(workspace, fileName);
    if (await pathExists(target)) {
      selected.push(target);
    }
  }

  return selected.slice(0, 8);
}

async function readImportantFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").slice(0, 220).join("\n");
  return `## ${path.basename(filePath)}\n${truncate(lines, 12_000)}`;
}

async function tryGit(workspace, args) {
  return runCommand("git", args, {
    cwd: workspace,
    allowFailure: true,
    timeoutMs: 20_000,
  });
}

export async function collectWorkspaceContext(workspace) {
  const fileTree = [];
  await walk(workspace, workspace, fileTree);

  const importantFiles = await collectImportantFiles(workspace);
  const importantSnippets = [];
  for (const filePath of importantFiles) {
    importantSnippets.push(await readImportantFile(filePath));
  }

  const gitRoot = await tryGit(workspace, ["rev-parse", "--show-toplevel"]);
  const inGitRepo = gitRoot.exitCode === 0;
  const gitBranch = inGitRepo
    ? await tryGit(workspace, ["branch", "--show-current"])
    : null;
  const gitStatus = inGitRepo
    ? await tryGit(workspace, ["status", "--short"])
    : null;
  const gitDiffStat = inGitRepo
    ? await tryGit(workspace, ["diff", "--stat"])
    : null;

  return {
    workspace,
    generatedAt: new Date().toISOString(),
    inGitRepo,
    gitRoot: gitRoot?.stdout?.trim() || null,
    gitBranch: gitBranch?.stdout?.trim() || null,
    gitStatus: truncate(gitStatus?.stdout?.trim() || "clean or unavailable", 4000),
    gitDiffStat: truncate(gitDiffStat?.stdout?.trim() || "none", 4000),
    fileTree: truncate(fileTree.join("\n") || "(empty workspace)", 10_000),
    importantFiles: importantFiles.map((filePath) => path.relative(workspace, filePath)),
    importantSnippets: truncate(importantSnippets.join("\n\n"), 20_000),
  };
}

export async function snapshotWorkspace(workspace) {
  const files = new Map();

  async function recurse(dirPath) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspace, absolutePath);
      if (entry.isDirectory()) {
        await recurse(absolutePath);
        continue;
      }
      const stat = await fs.stat(absolutePath);
      files.set(relativePath, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  await recurse(workspace);
  return files;
}

export function diffSnapshots(before, after) {
  const changed = [];
  const added = [];
  const removed = [];

  for (const [file, meta] of after.entries()) {
    const prev = before.get(file);
    if (!prev) {
      added.push(file);
      continue;
    }
    if (prev.size !== meta.size || prev.mtimeMs !== meta.mtimeMs) {
      changed.push(file);
    }
  }

  for (const file of before.keys()) {
    if (!after.has(file)) {
      removed.push(file);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

export async function collectDiffFocus(workspace, fallbackSnapshotDiff = null) {
  const gitRoot = await tryGit(workspace, ["rev-parse", "--show-toplevel"]);
  if (gitRoot.exitCode === 0) {
    const names = await tryGit(workspace, ["diff", "--name-only"]);
    const stat = await tryGit(workspace, ["diff", "--stat"]);
    const patch = await tryGit(workspace, ["diff", "--"]);
    return {
      changedFiles: names.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      diffStat: truncate(stat.stdout.trim() || "none", 4000),
      diffPatch: truncate(patch.stdout.trim() || "none", 20_000),
    };
  }

  const fileSnippets = [];
  const changedFiles = [
    ...(fallbackSnapshotDiff?.added || []),
    ...(fallbackSnapshotDiff?.changed || []),
    ...(fallbackSnapshotDiff?.removed || []).map((item) => `${item} (removed)`),
  ];

  for (const entry of changedFiles.slice(0, 10)) {
    if (entry.endsWith("(removed)")) {
      fileSnippets.push(`## ${entry}\n(removed)`);
      continue;
    }
    try {
      const absolutePath = path.join(workspace, entry);
      const contents = await fs.readFile(absolutePath, "utf8");
      fileSnippets.push(`## ${entry}\n${truncate(contents, 5000)}`);
    } catch {
      fileSnippets.push(`## ${entry}\n(unreadable)`);
    }
  }

  return {
    changedFiles,
    diffStat: fallbackSnapshotDiff
      ? truncate(
          `Added:\n${fallbackSnapshotDiff.added.join("\n") || "(none)"}\n\nChanged:\n${fallbackSnapshotDiff.changed.join("\n") || "(none)"}\n\nRemoved:\n${fallbackSnapshotDiff.removed.join("\n") || "(none)"}`,
          4000,
        )
      : "unavailable",
    diffPatch: truncate(fileSnippets.join("\n\n") || "unavailable", 20_000),
  };
}
