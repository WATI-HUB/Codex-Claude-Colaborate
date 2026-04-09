# TODO

활성 작업: **Phase별 모델/effort/권한** (설계 → `src/engine/CLAUDE.md`)

- [ ] Verification 1~7 실행 (체크 항목은 `src/engine/CLAUDE.md` "Verification" 참조)

다음 작업: **단일 실행 + Plan 승인 게이트** (설계 → `src/app/CLAUDE.md` "Planned: 단일 실행…", `src/engine/CLAUDE.md` "Planned: runFullPipeline Plan 승인 훅")

- [ ] `pipeline.mjs` `onPlanReady` 훅 + go/abort/revise 분기 — `src/engine/`
- [ ] `src/app/plan-gate.mjs` 신규 (readline, chat-ui 패턴 재사용) — `src/app/`
- [ ] `cli.mjs` 기본 진입점/`--yes`/TTY 감지/help 재작성 + 게이트 주입 — `src/app/`
- [ ] Verification 1~7 (`src/app/CLAUDE.md` 참조)

## 운용 규칙

- 항목 완료 즉시 체크 후 제거 (히스토리는 git log)
- 30줄 이하 유지
- 새 작업은 해당 폴더 `CLAUDE.md`에 설계 추가 → 여기에 한 줄
- 활성 작업이 통째로 끝나면 다음 작업으로 교체
