# Codex Claude Debate

Claude Code와 Codex가 로컬에서 두 명의 개발자처럼 토론하고, 합의된 쪽이 구현하고, 반대쪽이 검증하는 오케스트레이터입니다.

추가 API 키나 별도 API 과금 없이, 이미 로그인된 `Claude Code`와 `Codex` 로컬 설치를 그대로 사용합니다.

## 전제 조건

- macOS
- `Codex.app` 설치 및 로그인
- `Claude Code` 설치 및 로그인
- Node.js 설치

이 프로젝트는 외부 npm 패키지 없이 동작합니다.

## 사용법

작업할 프로젝트 디렉터리에서 아래처럼 실행하면 채팅형 터미널이 열립니다.

```bash
node /Users/gimdong-wan/Codex-Claude-Debate/src/cli.mjs
```

또는 실행 스크립트:

```bash
zsh /Users/gimdong-wan/Codex-Claude-Debate/run-debate.sh
```

채팅형 모드 안에서는:

- 긴 요청을 여러 줄로 입력
- `/send` 로 전송
- `/help` 로 명령 보기
- `/clear` 로 현재 입력 버퍼 초기화

원하면 기존처럼 한 줄 명령으로도 실행할 수 있습니다.

```bash
npm run debate -- "새 기능을 구현해줘"
```

작업 흐름:

1. 사용자 요청을 받음
2. Codex와 Claude가 초기 기획 워크숍 진행
3. 사용자도 중간에 기능 아이디어, 우선순위, 제약을 직접 입력
4. 이후 Codex와 Claude가 구현 담당 승자를 합의
5. 합의된 쪽이 구현
6. 반대쪽이 실제 코드 검증
7. 검증 결과를 바탕으로 다시 토론
8. 수정 필요 시 합의된 승자가 수정
9. 합의가 안 되면 사용자 입력 대기

## 특징

- 승자는 프로그램이 정하지 않습니다.
- 두 에이전트가 서로의 메시지를 보고 합의해야 다음 단계로 진행합니다.
- 의미 없는 아부와 칭찬을 금지하는 프롬프트가 기본 포함됩니다.
- 구현 전에 사용자 참여형 기획 워크숍이 기본 실행됩니다.
- 인자 없이 실행하면 터미널 채팅 세션이 열립니다.
- 실행 로그와 토론 기록은 `.agent-debate/runs/...`에 저장됩니다.
- 토론 단계는 구조화된 JSON 응답을 사용해 자동 파싱합니다.
- 검증 단계에서 이견이 남으면 사용자에게 tie-breaker를 요청합니다.

## 권장 실행 예시

```bash
cd /path/to/your/project
node /Users/gimdong-wan/Codex-Claude-Debate/src/cli.mjs "사용자 인증 플로우를 리팩터링하고 테스트까지 맞춰줘"
```

## 사전 점검

```bash
npm run doctor
```

`doctor`는 다음을 확인합니다.

- Codex 실행 파일 탐지
- Claude 실행 파일 탐지
- Codex 로그인 흔적 파일 존재 여부
- Claude 로그인 흔적 파일 존재 여부
- Claude `login shell` 기준 실제 인증 상태

파일 흔적은 참고용이고, Claude는 `login shell` 기준 실제 인증 상태도 함께 검사합니다.

## Claude 인증 참고

이 오케스트레이터는 Claude API 키가 아니라 `claude` CLI의 로그인 상태를 그대로 사용합니다.

일반 실행(`chat`, `plan`, `run`, `pipeline`)을 시작하면 먼저 `codex`와 `claude` 로그인 상태를 확인합니다. 미로그인 상태면 현재 터미널에서 자동으로 로그인 절차를 시작한 뒤, 인증이 확인되어야 다음 단계로 진행합니다.

만약 실행 시 Claude 쪽에서 `Not logged in`이 뜨면 다음 중 하나를 먼저 완료해야 합니다.

```bash
claude auth
```

또는 구독 기반 토큰 설정이 필요한 경우:

```bash
claude setup-token
```

## 환경 변수

선택 사항입니다. 기본값만으로도 돌아가도록 설계했습니다.

- `DEBATE_WORKSPACE`: 작업 디렉터리
- `DEBATE_PLANNING_ROUNDS`: 초기 기획 워크숍 최대 라운드 수
- `DEBATE_ROUNDS`: 초기 토론 최대 라운드 수
- `DEBATE_REPAIR_ROUNDS`: 수정 방향 토론 최대 라운드 수
- `DEBATE_MAX_CYCLES`: 구현-검증-수정 최대 반복 횟수
- `DEBATE_SKIP_WORKSHOP=1`: 초기 기획 워크숍 생략
- `DEBATE_CODEX_BIN`: Codex CLI 경로
- `DEBATE_CLAUDE_BIN`: Claude CLI 경로
- `DEBATE_CODEX_MODEL`: Codex 모델 override
- `DEBATE_CLAUDE_MODEL`: Claude 모델 override
- `DEBATE_CLAUDE_DANGEROUS=1`: Claude에 `--dangerously-skip-permissions`를 추가

## 주의

- Codex 쪽은 `Codex.app`에 포함된 CLI를 사용합니다.
- Claude 쪽은 로컬 `claude` CLI를 사용하며, 일반 터미널과 최대한 동일하게 `login shell`을 통해 실행합니다.
- 구현 단계에서 두 도구 모두 실제 파일을 수정할 수 있습니다.
- 매우 민감한 저장소에서는 먼저 별도 브랜치나 복사본에서 실행하는 것을 권장합니다.
