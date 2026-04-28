import { join } from 'path';
import type { ToolCategory, DangerPattern } from '../types.js';

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';

// HARNESS_DIR_ROOT override: tests can set this env var before first import
// to redirect all harness file I/O to a temp directory.
export const HARNESS_DIR = process.env.HARNESS_DIR_ROOT
    ? join(process.env.HARNESS_DIR_ROOT, 'harness')
    : join(HOME, '.config/opencode/harness');

// Cross-file shared constants
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ERROR_SUMMARY_LENGTH = 200;

// ─── Token Optimizer v0 constants ───────────────────────

/** Per-category session budget limits (v0 hardcoded) */
export const BUDGET_LIMITS: Record<ToolCategory, number> = {
    search: 20,
    read: 30,
    test: 10,
    write: 20,
    other: 50,
};

/** Danger patterns for pre_tool_guard — commands likely to produce large output */
export const DANGER_PATTERNS: DangerPattern[] = [
    {
        regex: /\bcat\s+\S+/,
        alternative: 'tail -200 <file> 또는 rg "패턴" <file> -n | head -200',
        label: 'cat <file>',
    },
    {
        regex: /\bls\s+.*-R/,
        alternative: 'ls 또는 find . -maxdepth 2',
        label: 'ls -R',
    },
    {
        regex: /\bfind\s+\.\s*[^|]*$/,
        alternative: 'find . -maxdepth 3 -type f',
        label: 'find . (no depth limit)',
    },
    {
        regex: /\bgrep\s+-[rR].*\.\s*$/,
        alternative: 'rg "패턴" --glob \'!node_modules\' --glob \'!dist\'',
        label: 'grep -R . (no exclude)',
    },
    {
        regex: /\bdocker\s+logs\s+(?!.*--tail)\S/,
        alternative: 'docker logs --tail 200 <container>',
        label: 'docker logs (no --tail)',
    },
    {
        regex: /\bgit\s+log\s*$/,
        alternative: 'git log --oneline -20',
        label: 'git log (unlimited)',
    },
];

/** Compaction override prompt for compact_override */
export const COMPACT_OVERRIDE_PROMPT = `## Compaction Directive

보존 최우선순위 (절대 버리지 마):
1. 사용자의 원래 목표와 현재 작업 상태
2. 현재 수정 중인 파일 경로와 수정 의도
3. 이미 내린 설계 결정과 그 이유
4. 실패한 시도와 실패 이유
5. 통과한 테스트 결과
6. 다음 한 단계 (구체적으로)

폐기 가능 (컨텍스트 압력이 높으면 과감히 버려):
1. 긴 로그 원문 (요약으로 대체)
2. 중복 탐색 과정 (결론만 유지)
3. 이미 확인 완료된 파일 목록
4. 장황한 설명과 전제 조건 나열
5. 실패한 가설의 세부 출력 (실패 이유만 유지)
6. 이미 반영된 규칙의 전문 (존재 여부만 유지)

작업 상태 캡슐:
- goal: 사용자의 원래 목표
- changed_files: 수정한 파일과 수정 내용 요약
- decisions: 내린 결정 목록
- failed_attempts: 실패한 접근과 원인
- verified: 확인 완료된 것들
- next_step: 다음에 해야 할 한 가지`;

/** File deduper: read count threshold before checking mtime/size */
export const FILE_DEDUPER_THRESHOLD = 3;
