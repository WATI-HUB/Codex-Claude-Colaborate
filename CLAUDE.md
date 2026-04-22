# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local orchestration system where Codex and Claude Code debate implementation strategies like two senior engineers. 별도 API 과금 없이 사용자가 구독 중인 GPT Pro(Codex)와 Claude Code의 로컬 CLI 인증을 그대로 사용. Zero npm dependencies; pure Node.js with ES modules (`.mjs`).

Primary language is Korean for documentation and prompts.

## Commands

```bash
node src/app/cli.mjs                    # Interactive chat mode
node src/app/cli.mjs "task description" # Run single task
npm run doctor                      # Verify Codex/Claude binaries and auth
npm run test                        # E2E smoke test (node e2e-test.mjs)
npm run debate -- "task"            # Alias for single task run
```

## Environment Variables (all optional)

- `DEBATE_WORKSPACE` — working directory (default: cwd)
- `DEBATE_PLANNING_ROUNDS` / `DEBATE_ROUNDS` / `DEBATE_REPAIR_ROUNDS` — max rounds per phase (defaults: 3/3/2)
- `DEBATE_MAX_CYCLES` — max implement-verify-repair cycles (default: 3)
- `DEBATE_SKIP_WORKSHOP=1` — skip planning workshop phase
- `DEBATE_CODEX_BIN` / `DEBATE_CLAUDE_BIN` — override CLI paths
- `DEBATE_CODEX_MODEL` / `DEBATE_CLAUDE_MODEL` — override models (모든 phase 공통 fallback)
- `DEBATE_CLAUDE_DANGEROUS=1` — pass `--dangerously-skip-permissions` to Claude

### Phase별 모델 / effort / 권한 (전부 optional)

4 phase: `plan`, `debate`, `implement`, `review`. 권장 패턴은 **plan/implement는 풀스펙 유지, debate/review만 절약**.

Codex
- `DEBATE_CODEX_EFFORT` (low|medium|high) — 전 phase 기본 reasoning effort
- `DEBATE_CODEX_SANDBOX` (read-only|workspace-write|danger-full-access) — 전 phase 기본 sandbox
- `DEBATE_CODEX_MODEL_PLAN` / `_DEBATE` / `_IMPLEMENT` / `_REVIEW` — phase별 모델
- `DEBATE_CODEX_EFFORT_PLAN` / `_DEBATE` / `_IMPLEMENT` / `_REVIEW` — phase별 effort
- `DEBATE_CODEX_SANDBOX_PLAN` / `_DEBATE` / `_IMPLEMENT` / `_REVIEW` — phase별 sandbox

Claude
- `DEBATE_CLAUDE_PERMISSION` (plan|acceptEdits|dontAsk|default|bypassPermissions) — 전 phase 기본
- `DEBATE_CLAUDE_MODEL_PLAN` / `_DEBATE` / `_IMPLEMENT` / `_REVIEW` — phase별 모델
- `DEBATE_CLAUDE_PERMISSION_PLAN` / `_DEBATE` / `_IMPLEMENT` / `_REVIEW` — phase별 권한 모드

CLI 플래그도 env와 1:1 대응 (`--codex-model-debate`, `--claude-permission-review` 등).

프리셋
- `--cheap` — debate/review만 effort↓ + Claude `plan` 모드. plan/implement는 안 깎음. 모델 강제 다운시프트 없음
- `--max` — 전 phase effort=high
- 개별 플래그가 프리셋보다 우선

## Context References

- @TODO.md — 활성 작업 체크리스트 (세션 시작 시 가장 먼저)
- @src/CLAUDE.md — `src` 디렉터리 인덱스
- @src/app/CLAUDE.md — CLI, 채팅 세션, 터미널 상호작용
- @src/core/CLAUDE.md — auth, state, utils, context, terminal
- @src/engine/CLAUDE.md — pipeline, planner, executor, prompts, consensus

## Current Handoff

- 현재 활성 진입점은 `src/app/cli.mjs`, 활성 파이프라인은 `runFullPipeline`
- 활성 작업 항목은 `TODO.md`, 작업 설계는 해당 Folder `CLAUDE.md`에 둔다 (이 Project Root에는 쌓지 않는다)
- 최근 큰 변경: auth gate, tty suspend 완화, plan finalization 수렴형 재설계
- 로컬 환경에서는 Claude 로그인/OAuth callback 이슈 가능성 있음

(컨텍스트 관리 원칙은 Global `~/.claude/CLAUDE.md` 참조)
