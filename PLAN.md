# PLAN.md — 파이프라인 리디자인 계획

이 문서는 Codex-Claude-Debate 오케스트레이터를 새로운 흐름으로 리디자인하기 위한 마스터 플랜이다. 구현 진행 중에는 이 파일을 단일 진실 공급원(SSoT)으로 삼는다.

## 목표 (Why)

기존 파이프라인(`Planning Workshop → Initial Debate → [Implement → Verify → Repair] × N`)을 다음으로 교체:

1. **Plan Mode** — 두 에이전트가 합의로 상세 플랜 작성. 필요 시 사용자 인터뷰. 결과를 마크다운으로 영속화.
2. **Clear** — feature간 컨텍스트 격리. 다음 feature 시작 시 이전 feature의 토론/구현 로그를 절대 전달하지 않는다.
3. **TDD Execute Mode** (feature별 반복):
   - Debate (동적 라운드)
   - Winner 구현
   - Test → Lint → 통과 시 git commit
   - Review debate (둘 다 approve까지) → 수정 → test → commit 반복
   - 합의 불가 시 사용자 호출
4. **Clear & Next Feature**
5. 모든 feature 완료까지 3-4 반복

핵심 원칙: **토큰 절약**(컨텍스트 격리), **git 버전관리**, **TDD 루프**, **자동 + 사용자 체크포인트**.

## 주의사항 (사용자 명시)

- 합의 불가 또는 사용자 의견 필요 시 → 대기 후 사용자 지시 기다림
- 한 구현에 과한 토론으로 토큰 낭비 금지 (테스트가 검증함)
- 플랜 모드에서 최대한 구체적으로 → 구현 단계 수월
- TDD 루프: 작은 변경 → 테스트 → 린트 → 커밋 → 반복

## 전략

기존 코드 최대한 재사용. `orchestrator.mjs`의 검증된 빌딩 블록(`runDebateLoop`, `debateConsensus`, `runVerification`, `requestUserInput` 등)은 export만 추가해 그대로 활용. 새 파이프라인은 별도 파일에 구성. 기존 `runOrchestrator`는 당분간 유지하여 e2e 회귀 방지.

## 신규 파일

| 파일 | 역할 |
|---|---|
| `src/state.mjs` | `.agent-debate/state.json` 읽기/쓰기. phase, features 진행 상태 추적 |
| `src/git-ops.mjs` | git 브랜치/커밋/조회 (utils.mjs `runCommand` 래핑) |
| `src/planner.mjs` | Phase 1 Plan Mode. PLAN.md/feature-XXX.md 산출 |
| `src/executor.mjs` | Phase 3 TDD Execute. feature별 debate→implement→test→lint→commit→review 루프 |
| `src/pipeline.mjs` | planner + state + executor 조립한 신규 최상위 (`runFullPipeline`) |

## 수정 파일

### `src/orchestrator.mjs`
내부 헬퍼에 `export` 추가만 (동작 변경 0):
`runDebateLoop`, `debateConsensus`, `runPlanningWorkshop`, `runVerification`, `requestUserInput`, `bothNeedUserInput`, `validateDebateShape`, `validatePlanningShape`, `validateVerificationShape`, `printDebateRound`, `printPlanningRound`, `formatElapsed`. `runOrchestrator`는 그대로.

### `src/prompts.mjs` (확장)
- **Schemas**: `planFinalizationSchema`(features[{id,name,description,acceptance_criteria,estimated_complexity}], test_command, lint_command, git_strategy{base_branch,branch_prefix}, summary), `reviewSchema`(status: approve|request_changes|escalate, findings, message)
- **Builders**: `buildPlanFinalizationPrompt`, `buildFeatureDebatePrompt`, `buildFeatureImplementationPrompt`, `buildReviewPrompt`, `buildTestFailureGuidance`
- **Renderers**: `renderPlanSummaryMarkdown(planResult)`, `renderFeaturePlanMarkdown(feature)`

### `src/cli.mjs`
서브커맨드 추가: `plan "task"`, `run`(state 이어서 실행), `status`. 기존 `chat`/`doctor`/`help` 유지. 인자 없이 task 문자열만 주면 `runFullPipeline` 자동 실행.

### `src/chat-session.mjs`
import만 `runFullPipeline`로 갱신.

### `e2e-test.mjs`
새 파이프라인 기준으로 갱신. plan-only + 전체 자동 시나리오.

## State Schema (`.agent-debate/state.json`)

```json
{
  "version": 1,
  "task": "원본 사용자 요청",
  "phase": "planning|executing|completed",
  "planFile": ".agent-debate/PLAN.md",
  "features": [
    {
      "id": "feature-001",
      "name": "...",
      "planFile": ".agent-debate/plans/feature-001.md",
      "status": "pending|in_progress|completed|failed",
      "branch": "feature/feature-001",
      "commits": []
    }
  ],
  "currentFeatureIndex": 0,
  "gitStrategy": {"baseBranch": "main", "branchPrefix": "feature/"},
  "testCommand": "npm test",
  "lintCommand": "npm run lint",
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

## TDD Execute Loop (per feature)

1. **Context Load**: `feature.planFile` + `collectWorkspaceContext()` + `CLAUDE.md` + PLAN.md 요약(feature 목록만). **이전 feature 토론/로그 절대 포함 X.**
2. **Pre-debate**: feature 브랜치 생성 (`git-ops.createBranch`)
3. **Debate** (`runDebateLoop` 재사용): 동적 maxRounds = `{small:1, medium:2, large:3}[complexity]`
4. **Implement**: winner가 `agent.implement()` 실행
5. **Test**: `state.testCommand` 실행. 실패 시 출력 → `buildTestFailureGuidance` → 4로 점프
6. **Lint**: `state.lintCommand` 실행. 실패 시 동일하게 가이드 생성 후 4로
7. **Commit**: `git-ops.commitAll(workspace, "feat(feature-id): ...")`
8. **Review** (양 에이전트 `runStructured` 리뷰): 둘 다 approve면 종료
9. 둘 중 하나라도 request_changes → 누가 고칠지 debate → 4로 (최대 `maxReviewCycles=3`)
10. 초과 시 사용자 호출 (`requestUserInput`)
11. 종료 시 `state.advanceFeature()`, 다음 feature로 → 컨텍스트 격리 자연 발생

## Clear의 실제 구현

Codex/Claude CLI는 매 호출마다 이미 새 subprocess이므로 "clear"는 **prompt builder가 의도적으로 이전 feature 자료를 제외**하는 것으로 충분하다. `executor.mjs`의 prompt builder 호출 시 `transcript`/`history`에 빈 배열을 넘기고, plan은 `feature.planFile`만 읽는다. 워크스페이스 스냅샷은 매번 새로 수집되므로 누적된 코드 변경은 자연스럽게 반영된다.

## 구현 순서

1. `src/state.mjs` (독립)
2. `src/git-ops.mjs` (독립)
3. `src/orchestrator.mjs`에 export 추가 (동작 변경 0)
4. `src/prompts.mjs`에 새 schema/builder 추가
5. `src/planner.mjs`
6. `src/executor.mjs`
7. `src/pipeline.mjs`
8. `src/cli.mjs` 서브커맨드 라우팅
9. `src/chat-session.mjs` import 갱신
10. `e2e-test.mjs` 갱신

## 위험과 완화

- **테스트/린트 명령 환각**: plan finalization에서 `commandExists`로 검증. 실패 시 사용자 재확인.
- **Review 무한루프**: `maxReviewCycles=3` 하드캡 → 사용자 호출.
- **Git 미초기화 워크스페이스**: `context.mjs`의 `inGitRepo` 재사용. git 없으면 commit 단계 skip + 경고.
- **컨텍스트 누수**: prompt builder에서 prior feature 포함 금지를 회귀 테스트로 방어.
- **Backward compat**: 기존 `runOrchestrator`/e2e-test 당분간 유지. 새 파이프라인 안정화 후 deprecate.

## Verification

1. `node src/cli.mjs doctor` — 바이너리/인증 정상
2. `node src/cli.mjs plan "간단한 todo CLI"` — `.agent-debate/PLAN.md`와 `plans/feature-*.md` 생성
3. `node src/cli.mjs status` — state.json 사람이 읽기 좋게 출력
4. `node src/cli.mjs run` — feature 하나씩 진행, 각 commit이 git log에 남는지 확인
5. `npm run test` — 새 파이프라인 smoke test 통과
6. 합의 불가 시나리오 → 사용자 호출 동작 확인
7. 컨텍스트 격리 회귀 테스트: feature N+1 프롬프트에 feature N transcript 미포함을 grep으로 확인

## 진행 상태

- [x] 1. state.mjs
- [x] 2. git-ops.mjs
- [x] 3. orchestrator.mjs export 추가
- [x] 4. prompts.mjs 확장
- [x] 5. planner.mjs
- [x] 6. executor.mjs
- [x] 7. pipeline.mjs
- [x] 8. cli.mjs 서브커맨드
- [x] 9. chat-session.mjs import
- [x] 10. e2e-test.mjs
