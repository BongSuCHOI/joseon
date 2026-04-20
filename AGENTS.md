# Role & Identity

- 당신은 이 프로젝트의 전담 AI 코딩 어시스턴트입니다.
- 주력 분야: OpenCode 플러그인 개발, 하네스(Harness) 시스템 아키텍처, 멀티 에이전트 오케스트레이션.
- 언어: 사용자 응답은 한국어. 내부 추론/코드/커밋메시지는 영어.

# Project

**harness-orchestration** — OpenCode 플러그인 기반 하네스 + 오케스트레이션 시스템.
Hugh Kim의 아키텍처를 OpenCode 플러그인으로 재구현. 단일 에이전트 품질 제어(하네스)부터 멀티 에이전트 조율(오케스트레이션)까지 4단계 점진 구축. Step 1~4 + Step 5a~5h 전부 완료.

# Core Rules

1. **파일 = 진실:** DB/IPC 없이 파일 시스템만으로 상태 관리. `~/.config/opencode/harness/`가 유일한 진실의 원천.
2. **하네스 먼저:** 오케스트레이션보다 하네스를 먼저 구현. 서브에이전트가 하네스의 통제를 자동으로 받도록.
3. **SOFT→HARD 자동 승격:** 모든 규칙은 SOFT로 시작. 위반 2회 이상 재발 시 HARD로 자동 승격. 단, `scope: 'prompt'` 규칙은 승격 대상이 아님.
4. **단일 패키지, 다중 export:** 4개 플러그인을 하나의 npm 패키지로 배포.
5. **공통 유틸리티 분리:** `utils.ts`의 함수는 각 플러그인에서 반드시 import. 절대 복붙하지 않음.

# File Structure

```
src/
├── index.ts                  # 플러그인 진입점
├── types.ts                  # 전체 타입 정의
├── harness/                  # 하네스 레이어
│   ├── observer.ts           # L1 관측 + L2 신호 변환
│   ├── enforcer.ts           # L4 HARD 차단 + SOFT 위반 추적
│   ├── improver.ts           # L5 자가개선 + L6 폐루프
│   └── canary.ts             # canary 평가 (shadow + mismatch)
├── orchestrator/             # 오케스트레이션 레이어
│   ├── orchestrator.ts       # 최상위 라우터 (qa-tracker wiring + agent_id)
│   ├── qa-tracker.ts         # QA 실패 추적
│   └── subagent-depth.ts     # 서브에이전트 깊이 추적
├── agents/                   # 에이전트 정의 (10개)
│   ├── agents.ts
│   └── prompts/              # 에이전트 프롬프트
├── hooks/                    # 훅 모듈 (7개)
├── shared/                   # 공통 유틸리티
│   ├── utils.ts, logger.ts, constants.ts
│   └── index.ts              # 배럴 export
└── config/                   # 설정 시스템 (JSONC 로더)
```

# Documentation Index

| 문서 | 내용 |
|------|------|
| [`docs/architecture.md`](docs/architecture.md) | 전체 시스템 아키텍처 (하네스 4단계, L1~L6, 폐루프, 메모리, shadow/guarded-off) |
| [`docs/conventions.md`](docs/conventions.md) | 코딩 규칙, 플러그인 export 패턴, import 규칙 |
| [`docs/development.md`](docs/development.md) | 개발/빌드/테스트 절차, OpenSpec 워크플로우 |
| [`docs/roadmap.md`](docs/roadmap.md) | 향후 고도화 로드맵 (shadow→guarded→mainline 승격 기준) |
| [`docs/v3-final.md`](docs/opencode-harness-orchestration-guide-v3-final.md) | 초기 구현 가이드 (레거시 참고용, 현재 아키텍처와 다를 수 있음) |
| [`docs/api-confirmation.md`](docs/api-confirmation.md) | OpenCode Plugin API 확인 문서 |

# Key References

- [OpenCode Plugins](https://opencode.ai/docs/plugins/) — 플러그인 구조, 훅 목록
- [OpenCode Agents](https://opencode.ai/docs/agents/) — 에이전트 타입, 서브에이전트
- [OpenSpec Workflows](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md) — 워크플로우 정의
