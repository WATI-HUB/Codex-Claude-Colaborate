# src/ — Core Source

## Orchestration Pipeline (`orchestrator.mjs`)

```
Planning Workshop → Initial Debate → [Implementation → Verification → Repair Debate] × N → Done
```

1. **Planning Workshop** (`runPlanningWorkshop`) — Codex and Claude discuss scope/risks/features; user can contribute interactively
2. **Initial Debate** (`runDebateLoop`) — agents debate approach and vote on implementation winner via consensus
3. **Implementation** — winner implements using full-auto/dontAsk mode
4. **Verification** (`runVerification`) — non-implementer reviews actual code changes using workspace snapshots and git diffs
5. **Repair Debate** — agents decide if more fixes needed; `winner=none` means done

Each cycle's artifacts are saved to `.agent-debate/runs/[timestamp]/`.

## Consensus Logic (`debateConsensus`)

Both agents must `agree` and pick the same winner. Cross-concession (each volunteering the other) is resolved by self-nomination. If both pick invalid winners, falls back to "codex".

## Agent Execution Modes (`agents.mjs`)

- **Structured**: JSON schema-constrained output, read-only sandbox (used for debate/planning/verification)
- **Implementation**: Full file modification access (Codex uses `--full-auto`; Claude uses `dontAsk` permission)

Claude agent has a fallback path: tries login shell (`zsh -lc`) first, then direct command.

## Prompt Design (`prompts.mjs`)

System prompts enforce: no flattery, direct technical feedback, evidence-based reasoning. All structured phases use JSON schemas (`planningSchema`, `debateSchema`, `verificationSchema`) with validation functions (`validatePlanningShape`, `validateDebateShape`, `validateVerificationShape`).

## Source Files

| File | Role |
|------|------|
| `cli.mjs` | Entry point — argument parsing, binary resolution, command routing |
| `orchestrator.mjs` | Main engine — pipeline phases, consensus, cycle management |
| `agents.mjs` | `CodexAgent` and `ClaudeAgent` wrapper classes |
| `prompts.mjs` | All prompt templates, JSON schemas, response rendering |
| `context.mjs` | Workspace snapshots — file tree, git status/diff, priority file reading |
| `utils.mjs` | File I/O, process execution, shell integration |
| `chat-session.mjs` / `chat-ui.mjs` | Interactive terminal chat mode |
