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

## Phase별 모델 / effort / 권한

`plan/debate/implement/review` 4 phase 각각에 모델·effort(Codex)·sandbox(Codex)·permission-mode(Claude)를 독립 지정할 수 있다.

- 호출부는 `runStructured`/`implement`에 `phase` 인자를 넘긴다
  - `planner.mjs` → `phase: "plan"`
  - `executor.mjs` → feature debate `"debate"`, winner.implement `"implement"`, dual review `"review"`, repair debate `"debate"`
- 에이전트는 생성 시 `phaseModels`/`phaseEfforts`/`phaseSandboxes` 또는 `phasePermissions` 매핑을 받아 호출 시 phase로 dispatch
- 매핑이 비어 있으면 단일 `model`/`effort`/`sandbox`/`permission` fallback을 사용해 backward compatible
- 권장 패턴: plan/implement는 풀스펙 유지, debate/review만 다운시프트
- `--cheap` 프리셋은 debate/review에서만 effort↓ + Claude `plan` 모드, 모델 강제 다운시프트는 안 함

### 미구현 디테일 (작업 항목은 `TODO.md` 참조)

- `CodexAgent` 생성자 확장: `model`, `effort`, `sandbox` (전역 fallback) + `phaseModels`/`phaseEfforts`/`phaseSandboxes` 부분 매핑
- `ClaudeAgent` 생성자 확장: `model`, `permissionMode` + `phaseModels`/`phasePermissions` 매핑 (Claude effort는 CLI 미노출 → 모델로만 절약)
- `runStructured`/`implement`에 `phase` 옵션 추가. 인자 빌드 시:
  - Codex `-m` ← `phaseModels[phase] || model`
  - Codex `-c model_reasoning_effort=<...>` ← `phaseEfforts[phase] || effort` (있을 때만)
  - Codex sandbox: `phaseSandboxes[phase] || sandbox || (implement ? "workspace-write" : "read-only")`. 명시되면 `--full-auto` 대신 `-s <sandbox>` + `--ask-for-approval never`
  - Claude `--permission-mode` ← `phasePermissions[phase] || permissionMode`. 호출자가 직접 넘긴 `permissionMode`가 우선 (현 시그니처 보존)
- backward compat: 매핑·옵션이 비면 단일 model/effort/sandbox/permission fallback, 없으면 기존 하드코딩 동작 유지
- env/플래그 파싱은 `src/app/cli.mjs`에서 하고, `agentConfig: { codex: {...}, claude: {...} }` 객체로 `runFullPipeline`에 넘김
- `doctor` 명령은 해석된 phase × 에이전트 매트릭스(model/effort/sandbox/permission)를 표로 출력
- AGENTS.md는 5개 위치에 `ln -s CLAUDE.md AGENTS.md` 심볼릭 링크. Codex CLI가 자동 인식 (코드 변경 0)

### Verification

1. `node src/app/cli.mjs doctor` — 매트릭스 출력
2. `DEBATE_CODEX_EFFORT_REVIEW=low DEBATE_CLAUDE_PERMISSION_REVIEW=plan node src/app/cli.mjs plan "todo CLI"` 후 `.agent-debate/runs/*/codex/*.stdout.log`, `.../claude/*.stdout.log`에서 review phase 호출 인자 grep
3. `--cheap` 프리셋 → debate/review만 다운시프트, plan/implement는 그대로
4. 기존 env(`DEBATE_CODEX_MODEL`만) 회귀 — 모든 phase 동일
5. Claude debate/review가 `--permission-mode plan`일 때 파일 수정 시도 없는지 stdout 확인
6. `npm run test` smoke 통과
7. Codex stdout 로그에 `AGENTS.md` 자동 컨텍스트 인식 확인

## Current Notes

- `orchestrator.mjs`는 레거시 엔진도 남아 있으므로 삭제 대상이 아니다
- `agents.mjs`의 Codex는 sandbox 미지정 시 implement에서 `--full-auto`, runStructured에서 `read-only`. Claude는 implement에서 `--permission-mode dontAsk`가 기본 fallback
- 새 finalization 수렴 루프는 문법 검사는 끝났지만 full E2E는 추가 확인이 필요하다

## What To Update Here

- consensus rules
- prompt contract
- feature loop
- plan finalization logic
- agent execution strategy
