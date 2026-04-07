import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, pathExists, writeJson } from "./utils.mjs";

export const STATE_VERSION = 1;
export const STATE_DIR = ".agent-debate";
export const STATE_FILE = "state.json";

export function statePath(workspace) {
  return path.join(workspace, STATE_DIR, STATE_FILE);
}

export function createInitialState({ task, gitStrategy, testCommand, lintCommand }) {
  const now = new Date().toISOString();
  return {
    version: STATE_VERSION,
    task,
    phase: "planning",
    planFile: path.join(STATE_DIR, "PLAN.md"),
    features: [],
    currentFeatureIndex: 0,
    gitStrategy: gitStrategy || { baseBranch: "main", branchPrefix: "feature/" },
    testCommand: testCommand || "npm test",
    lintCommand: lintCommand || "npm run lint",
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadState(workspace) {
  const file = statePath(workspace);
  if (!(await pathExists(file))) {
    return null;
  }
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STATE_VERSION) {
      throw new Error(
        `Unsupported state version: expected ${STATE_VERSION}, got ${parsed?.version}`,
      );
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse state file ${file}: ${error.message}`);
  }
}

export async function saveState(workspace, state) {
  const file = statePath(workspace);
  await ensureDir(path.dirname(file));
  const next = { ...state, updatedAt: new Date().toISOString() };
  await writeJson(file, next);
  return next;
}

export function setFeaturesFromPlan(state, planResult) {
  const features = (planResult.features || []).map((feature, index) => {
    const id = feature.id || `feature-${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      name: feature.name || id,
      description: feature.description || "",
      acceptanceCriteria: feature.acceptance_criteria || [],
      complexity: feature.estimated_complexity || "medium",
      planFile: path.join(STATE_DIR, "plans", `${id}.md`),
      status: "pending",
      branch: `${state.gitStrategy.branchPrefix}${id}`,
      commits: [],
    };
  });

  return {
    ...state,
    features,
    currentFeatureIndex: 0,
    testCommand: planResult.test_command || state.testCommand,
    lintCommand: planResult.lint_command || state.lintCommand,
    gitStrategy: planResult.git_strategy
      ? {
          baseBranch: planResult.git_strategy.base_branch || state.gitStrategy.baseBranch,
          branchPrefix:
            planResult.git_strategy.branch_prefix || state.gitStrategy.branchPrefix,
        }
      : state.gitStrategy,
  };
}

export function currentFeature(state) {
  return state.features[state.currentFeatureIndex] || null;
}

export function updateFeature(state, featureId, patch) {
  const features = state.features.map((feature) =>
    feature.id === featureId ? { ...feature, ...patch } : feature,
  );
  return { ...state, features };
}

export function advanceFeature(state) {
  const nextIndex = state.currentFeatureIndex + 1;
  const phase = nextIndex >= state.features.length ? "completed" : "executing";
  return {
    ...state,
    currentFeatureIndex: nextIndex,
    phase,
  };
}

export function setPhase(state, phase) {
  return { ...state, phase };
}
