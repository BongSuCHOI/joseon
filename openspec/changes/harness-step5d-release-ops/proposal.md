## Why

npm 배포 이후에는 하네스 품질 제어와 별개로 최소한의 릴리스 운영 보조가 필요하다. 다만 이 기능은 세션 흐름을 방해하면 안 되므로 기본 비활성의 경량 알림으로 시작해야 한다.

## What Changes

- 세션 시작 시 버전 확인을 수행하는 auto-update-checker를 추가한다.
- 체크 실패는 무시하고, 알림은 warn-only로 제한한다.
- 기본값은 비활성으로 두고 TTL / 쿨다운으로 알림 빈도를 제어한다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot은 범위 밖으로 둔다.

## Capabilities

### New Capabilities
- `harness-step5d-release-ops`: 기본 비활성의 auto-update-checker와 릴리스 알림 운영을 다룬다.

### Modified Capabilities
- 없음

## Impact

- 세션 시작 훅, 버전 비교 유틸, 경고 로그와 쿨다운 상태 파일
- npm 배포 후 운영 문서와 검증 스모크 테스트
- 네트워크 실패를 세션과 분리하는 알림 경로
