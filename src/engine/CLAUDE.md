# src/engine/ — Debate Engine

이 폴더는 실제 Codex/Claude 토론, planning, execution을 담당한다.

## Files

- `agents.mjs` — Codex CLI / Claude CLI wrapper
- `pipeline.mjs` — active top-level pipeline
- `planner.mjs` — planning workshop + final plan convergence
- `executor.mjs` — feature debate / implement / test / lint / review loop
- `orchestrator.mjs` — shared planning/debate helpers + legacy engine
- `prompts.mjs` — prompt builders, schemas, markdown renderers
- `git-ops.mjs` — git branch/commit helpers

## Active Flow

`runFullPipeline`

1. planning workshop
2. plan finalization
3. feature-by-feature execute

## Plan Finalization

현재 finalization은 Codex 고정 채택이 아니다.

- 라운드 1: 양쪽 독립 초안
- 라운드 2~3: 상호 리뷰 후 수렴
- `plansAreEquivalent()`로 core plan 비교
- 같아졌고 `needs_user_input`이 아니면 shared plan 채택
- 끝까지 다르면 사용자 판단 요청

## Execution Loop

1. feature debate
2. winner implement
3. test
4. lint
5. dual review
6. approve면 next feature, 아니면 repair

## Current Notes

- `orchestrator.mjs`는 레거시 엔진도 남아 있으므로 삭제 대상이 아니다
- `agents.mjs`에서 Codex는 `--full-auto`, Claude는 `--permission-mode dontAsk`
- 새 finalization 수렴 루프는 문법 검사는 끝났지만 full E2E는 추가 확인이 필요하다

## What To Update Here

- consensus rules
- prompt contract
- feature loop
- plan finalization logic
- agent execution strategy
