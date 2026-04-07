# src/core/ — Shared Runtime

이 폴더는 app/engine이 공통으로 쓰는 런타임 레이어다.

## Files

- `auth.mjs` — Codex/Claude auth status check + interactive login handoff
- `context.mjs` — workspace file tree, important files, git status/diff snapshot
- `state.mjs` — `.agent-debate/state.json` schema and transitions
- `terminal.mjs` — colors, spinner, terminal display helpers
- `utils.mjs` — process execution, JSON/text I/O, login-shell helpers

## Current Notes

- auth는 `codex login status`, `claude auth status`를 기준으로 본다
- Claude는 login shell 우선 실행 경로를 유지한다
- 현재 로컬에서는 Claude OAuth callback 관련 환경 이슈 가능성이 있다
- planner/executor는 모두 `context.mjs`와 `state.mjs`에 의존한다

## What To Update Here

- 인증 로직
- subprocess 실행 정책
- 공용 파일 I/O
- 상태 저장 포맷
- workspace snapshot 범위
