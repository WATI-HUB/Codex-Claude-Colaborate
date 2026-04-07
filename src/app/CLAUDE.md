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

## What To Update Here

- CLI 옵션
- 채팅 세션 문구
- 터미널 입력/출력 처리
- 실행 전 사용자 상호작용 흐름
