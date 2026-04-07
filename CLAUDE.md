# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local orchestration system where Codex and Claude Code debate implementation strategies like two senior engineers. 별도 API 과금 없이 사용자가 구독 중인 GPT Pro(Codex)와 Claude Code의 로컬 CLI 인증을 그대로 사용. Zero npm dependencies; pure Node.js with ES modules (`.mjs`).

Primary language is Korean for documentation and prompts.

## Commands

```bash
node src/cli.mjs                    # Interactive chat mode
node src/cli.mjs "task description" # Run single task
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
- `DEBATE_CODEX_MODEL` / `DEBATE_CLAUDE_MODEL` — override models
- `DEBATE_CLAUDE_DANGEROUS=1` — pass `--dangerously-skip-permissions` to Claude

## Context References

- @PLAN.md — 진행 중인 파이프라인 리디자인 마스터 플랜 (Plan Mode → Clear → TDD Execute). 작업 시작 시 항상 먼저 확인.
- @src/CLAUDE.md — 오케스트레이션 파이프라인, 합의 로직, 에이전트 실행 모드, 프롬프트 설계, 소스 파일 맵

## Context Management Policy

프로젝트 지식은 처음부터 feature별 마크다운으로 분리하여 계층적으로 관리한다. Root CLAUDE.md는 참조 허브 역할만 한다.

### 구조

- **Root** `CLAUDE.md` — 프로젝트 요약 + 각 폴더별 CLAUDE.md 참조만 유지
- **폴더별** `{dir}/CLAUDE.md` — 해당 기능이 구현된 폴더 안에 상세 컨텍스트를 함께 배치

### 규칙

1. **상세 지식은 해당 기능 폴더의 CLAUDE.md에** — Root에 직접 상세 내용을 쓰지 않는다
2. **Root는 참조 허브**: `@{dir}/CLAUDE.md` 형태로 참조만 유지
3. **새 폴더/기능 추가 시** 해당 폴더에 CLAUDE.md 생성 → Root에 참조 추가
4. **중복 금지**: 같은 내용이 2곳 이상이면 하나로 통합
5. **자율 정리**: 중복, 관심사 혼재 발견 시 사용자 지시 없이 분리/재구성
