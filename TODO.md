# TODO

활성 작업: **Phase별 모델/effort/권한** (설계 → `src/engine/CLAUDE.md`)

- [ ] `agents.mjs` phase-aware 인자 빌드 (Codex/Claude) — `src/engine/`
- [ ] `cli.mjs` env/플래그/프리셋 파싱 + doctor 매트릭스 출력 — `src/app/`
- [ ] `pipeline.mjs` agentConfig 배선 — `src/engine/`
- [ ] `planner.mjs`/`executor.mjs` 호출부에 `phase` 인자 추가 — `src/engine/`
- [ ] `AGENTS.md` 심볼릭 링크 5개 (`/`, `src/`, `src/app/`, `src/core/`, `src/engine/`)
- [ ] Verification 1~7 실행 (체크 항목은 `src/engine/CLAUDE.md` "Verification" 참조)

## 운용 규칙

- 항목 완료 즉시 체크 후 제거 (히스토리는 git log)
- 30줄 이하 유지
- 새 작업은 해당 폴더 `CLAUDE.md`에 설계 추가 → 여기에 한 줄
- 활성 작업이 통째로 끝나면 다음 작업으로 교체
