# src/app/ — Entry And UI

이 폴더는 사용자와 직접 맞닿는 진입점과 채팅 UI를 다룬다.

## Files

- `cli.mjs` — 메인 엔트리. command parsing, binary resolution, auth gate, subcommand routing
- `chat-session.mjs` — interactive chat session loop
- `chat-ui.mjs` — readline 기반 multiline compose UI

## Current Notes

- 실제 실행 시작점은 `cli.mjs`
- 일반 실행(`chat`, `plan`, `run`, `pipeline`) 전에는 auth gate를 통과해야 한다
- `chat-ui.mjs`는 `SIGTTOU`/`SIGTTIN`을 무시해 `tty output` suspend를 줄인다

## Planned: 단일 실행 + Plan 승인 게이트 (미구현)

사용자는 `plan`/`run`/`pipeline`/`chat` 분리 서브커맨드를 번거로워함. 엔진(`runFullPipeline`, `runExecutor`)은 이미 end-to-end + TDD 자체 루프라 **CLI UX만 정리**한다.

### 목표 UX

- `node src/app/cli.mjs "task"` 한 줄 = plan → (1회 사용자 확인) → implement → test/lint/dual review/repair 자체 루프 → completed
- 진짜 필요한 순간(`orchestrator.requestUserInput`)에만 사용자 개입, 그 외엔 자동

### 변경 항목

1. **기본 커맨드 정리** (`cli.mjs`)
   - `node src/app/cli.mjs "task"`를 권장 진입점으로 help 재작성 (현재 `cli.mjs:334-362` 5가지 invocation 혼란)
   - `plan`은 제거하지 말고 내부적으로 `--plan-only` 플래그로 노멀라이즈 (하위호환)
   - 신규 플래그: `--yes` / `--auto` (게이트 스킵), env `DEBATE_AUTO_APPROVE_PLAN=1` 동치
   - stdin이 TTY 아니면 자동 `--yes` 간주

2. **Plan 승인 게이트** (`cli.mjs`가 `runFullPipeline`에 `onPlanReady` 콜백 주입)
   - Planner 완료 직후, executor 진입 전에 호출
   - feature 목록(`id`, `name`, `complexity`, 1-line) + `testCommand`/`lintCommand` 요약 출력
   - 입력 파싱: Enter/`y` → `{action:"go"}`, `q` → `{action:"abort"}` (state.json 남김, 다음 실행에 resume), `e <지시>` → `{action:"revise", note}`
   - resume 경로(state가 이미 `executing`)에서는 게이트 스킵

3. **신규 파일 `src/app/plan-gate.mjs`**
   - readline + SIGTTOU 무시 패턴은 `chat-ui.mjs` 재사용
   - 역할은 요약 출력 + 한 줄 입력 파싱만. 얇게 유지, 과설계 금지

### 건드리지 않는 것

- `executor.mjs` (이미 TDD 자체 루프 + `requestUserInput`)
- `planner.mjs`, `agents.mjs`, `orchestrator.mjs`

### Verification

1. Happy path: `node src/app/cli.mjs "smoke: 파일 하나"` → 게이트 → Enter → completed
2. `--yes`: 같은 명령 + `--yes` → 게이트 없이 통과, 로그에 skip 표시
3. Abort/resume: 게이트 `q` → 종료. 재실행 시 state.json 로드 → executor부터, 게이트 재노출 없음
4. Revise: `e 로깅 추가` → planner 1라운드 재실행, feature 변경 확인
5. Non-TTY: `... < /dev/null` → 자동 통과
6. 회귀: `plan`, `run`, `doctor`, `status` 기존 동작
7. `npm run test` 스모크 통과

(Pipeline 훅 쪽 상세는 `src/engine/CLAUDE.md` 참조)

## What To Update Here

- CLI 옵션
- 채팅 세션 문구
- 터미널 입력/출력 처리
- 실행 전 사용자 상호작용 흐름
