# src/ — Source Index

`src` 루트는 인덱스만 둔다. 상세 설계, 리스크, handoff는 하위 폴더 `CLAUDE.md`에 기록한다.

## Read In This Order

- @src/app/CLAUDE.md
- @src/core/CLAUDE.md
- @src/engine/CLAUDE.md

## Folder Map

- `src/app/` — CLI entrypoint, interactive chat session, terminal input UI
- `src/core/` — auth, state, terminal helpers, process utils, workspace context
- `src/engine/` — debate/planning/execution engine, prompts, agents, git ops

## Rule

- `src/CLAUDE.md`에 상세 동작을 계속 쌓지 않는다.
- 새 컨텍스트는 가장 가까운 하위 폴더 `CLAUDE.md`에 기록한다.
- 여러 폴더에 걸치는 내용만 루트 `CLAUDE.md` 또는 `PLAN.md`에 남긴다.
