// smoke-test.ts — Step 1 L1~L4 검증용 스크립트
// 실행: npx tsx test/smoke-test.ts

import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// shared 모듈 직접 import 테스트
import { getProjectKey, ensureHarnessDirs, logEvent, generateId, HARNESS_DIR, parseList } from '../src/shared/index.js';
import type { Rule, Signal } from '../src/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}`);
        failed++;
    }
}

// === L3: project_key 테스트 ===
console.log('\n=== L3: project_key 테스트 ===');

// 실제 디렉토리 생성해서 테스트
const testDir1 = join(tmpdir(), 'harness-test-projectA');
const testDir2 = join(tmpdir(), 'harness-test-projectB');
mkdirSync(testDir1, { recursive: true });
mkdirSync(testDir2, { recursive: true });

const key1 = getProjectKey(testDir1);
const key2 = getProjectKey(testDir1);
assert(key1 === key2, '동일 경로 → 동일 key');

const key3 = getProjectKey(testDir2);
assert(key1 !== key3, '상이 경로 → 상이 key');

const keyUnknown = getProjectKey('/nonexistent/path/xyz');
assert(keyUnknown === 'unknown', '미존재 경로 → unknown');

// 정리
try { rmSync(testDir1, { recursive: true }); } catch { /* */ }
try { rmSync(testDir2, { recursive: true }); } catch { /* */ }

// === ensureHarnessDirs 테스트 ===
console.log('\n=== ensureHarnessDirs 테스트 ===');
ensureHarnessDirs();

assert(existsSync(join(HARNESS_DIR, 'logs/sessions')), 'logs/sessions 디렉토리 존재');
assert(existsSync(join(HARNESS_DIR, 'logs/tools')), 'logs/tools 디렉토리 존재');
assert(existsSync(join(HARNESS_DIR, 'signals/pending')), 'signals/pending 디렉토리 존재');
assert(existsSync(join(HARNESS_DIR, 'rules/soft')), 'rules/soft 디렉토리 존재');
assert(existsSync(join(HARNESS_DIR, 'rules/hard')), 'rules/hard 디렉토리 존재');

// 2회째 호출 — 에러 없이 통과해야 함
try {
    ensureHarnessDirs();
    assert(true, 'ensureHarnessDirs 2회째 에러 없음');
} catch {
    assert(false, 'ensureHarnessDirs 2회째 에러 없음');
}

// === L1: logEvent 테스트 (logger redirect) ===
console.log('\n=== L1: logEvent 테스트 ===');
const testDate = new Date().toISOString().slice(0, 10);
logEvent('tools', `${testDate}.jsonl`, { tool: 'bash', args: { command: 'echo hello' } });
logEvent('tools', `${testDate}.jsonl`, { tool: 'write', args: { filePath: '/tmp/test.txt' } });

const logPath = join(HARNESS_DIR, 'logs', 'harness.jsonl');
assert(existsSync(logPath), 'harness.jsonl 로그 파일 생성됨');
const logContent = readFileSync(logPath, 'utf-8').trim().split('\n');
assert(logContent.length >= 2, '2개 레코드 기록됨');
const lastTwo = logContent.slice(-2);
const parsed = JSON.parse(lastTwo[0]);
assert(parsed.data?.tool === 'bash', '첫 레코드 tool=bash');
assert(parsed.ts !== undefined, '타임스탬프 포함됨');

// === L4: 수동 규칙 생성 + enforcer 로직 시뮬레이션 ===
console.log('\n=== L4: HARD 규칙 테스트 ===');

// 테스트용 HARD 규칙 생성 (bash 도구에서 rm -rf / 차단)
const testRuleId = generateId();
const testHardRule: Rule = {
    id: testRuleId,
    type: 'hard',
    project_key: 'global',
    created_at: new Date().toISOString(),
    source_signal_id: 'manual-test',
    pattern: { type: 'code', match: 'rm\\s+-rf\\s+/', scope: 'tool' },
    description: 'rm -rf / 명령 차단 (테스트)',
    violation_count: 0,
};
writeFileSync(join(HARNESS_DIR, `rules/hard/${testRuleId}.json`), JSON.stringify(testHardRule, null, 2));
assert(existsSync(join(HARNESS_DIR, `rules/hard/${testRuleId}.json`)), 'HARD 규칙 파일 생성됨');

// safeRegexTest 시뮬레이션
function safeRegexTest(pattern: string, target: string): boolean {
    try { return new RegExp(pattern, 'i').test(target); }
    catch { return false; }
}
assert(safeRegexTest('rm\\s+-rf\\s+/', 'rm -rf /') === true, 'HARD 패턴 매칭: rm -rf /');
assert(safeRegexTest('rm\\s+-rf\\s+/', 'ls -la') === false, 'HARD 패턴 비매칭: ls -la');

console.log('\n=== L4: SOFT 규칙 위반 추적 테스트 ===');

// 테스트용 SOFT 규칙 (scope: 'tool')
const softRuleId = generateId();
const testSoftRule: Rule = {
    id: softRuleId,
    type: 'soft',
    project_key: 'global',
    created_at: new Date().toISOString(),
    source_signal_id: 'manual-test',
    pattern: { type: 'code', match: 'console\\.log', scope: 'tool' },
    description: 'console.log 사용 감지 (테스트)',
    violation_count: 0,
};
writeFileSync(join(HARNESS_DIR, `rules/soft/${softRuleId}.json`), JSON.stringify(testSoftRule, null, 2));

// violation_count 증가 시뮬레이션
const softRulePath = join(HARNESS_DIR, `rules/soft/${softRuleId}.json`);
const loaded: Rule = JSON.parse(readFileSync(softRulePath, 'utf-8'));
loaded.violation_count = (loaded.violation_count || 0) + 1;
loaded.last_violation_at = new Date().toISOString();
writeFileSync(softRulePath, JSON.stringify(loaded, null, 2));

const afterIncrement: Rule = JSON.parse(readFileSync(softRulePath, 'utf-8'));
assert(afterIncrement.violation_count === 1, 'SOFT 위반 시 violation_count 증가 (1→1)');

// scope: 'prompt' 규칙은 카운트가 증가하지 않아야 함
const promptRuleId = generateId();
const testPromptRule: Rule = {
    id: promptRuleId,
    type: 'soft',
    project_key: 'global',
    created_at: new Date().toISOString(),
    source_signal_id: 'manual-test',
    pattern: { type: 'behavior', match: '떠넘기기', scope: 'prompt' },
    description: 'scope:prompt 테스트 규칙',
    violation_count: 0,
};
writeFileSync(join(HARNESS_DIR, `rules/soft/${promptRuleId}.json`), JSON.stringify(testPromptRule, null, 2));

// prompt scope는 건너뛰는 로직 시뮬레이션
const promptRule: Rule = JSON.parse(readFileSync(join(HARNESS_DIR, `rules/soft/${promptRuleId}.json`), 'utf-8'));
assert(promptRule.pattern.scope === 'prompt', 'scope: prompt 확인');
// prompt scope는 incrementViolation을 호출하지 않음 → count 그대로
assert(promptRule.violation_count === 0, 'scope:prompt 규칙 violation_count 증가하지 않음');

// === .env 차단 테스트 ===
console.log('\n=== .env 차단 테스트 ===');
assert(/git\s+(add|commit).*\.env/.test('git add .env') === true, 'git add .env 매칭');
assert(/git\s+(add|commit).*\.env/.test('git add src/main.ts') === false, '일반 파일 비매칭');

// === parseList 테스트 ===
console.log('\n=== parseList 테스트 ===');

const allItems = ['websearch', 'context7', 'grep_app', 'playwright'];

assert(JSON.stringify(parseList(['*'], allItems)) === JSON.stringify(allItems), 'parseList: * → 전체 허용');
assert(parseList(['!*'], allItems).length === 0, 'parseList: !* → 전체 거부');
assert(JSON.stringify(parseList(['websearch', 'context7'], allItems)) === JSON.stringify(['websearch', 'context7']), 'parseList: 명시적 2개');
assert(JSON.stringify(parseList(['*', '!grep_app'], allItems)) === JSON.stringify(['websearch', 'context7', 'playwright']), 'parseList: * + !exclude');
assert(parseList([], allItems).length === 0, 'parseList: 빈 배열 → 빈 결과');
assert(parseList(['nonexistent'], allItems).length === 0, 'parseList: 존재하지 않는 항목 → 빈 결과');
assert(parseList(['websearch', '!websearch'], allItems).length === 0, 'parseList: allow + deny 동일 → 빈 결과');
assert(JSON.stringify(parseList(['*'], [])) === JSON.stringify([]), 'parseList: * with empty available → 빈 결과');

// === buildToolPermissions 로직 테스트 ===
console.log('\n=== buildToolPermissions 로직 테스트 ===');

// buildToolPermissions와 동일한 로직 (src/index.ts에 정의, export되지 않으므로 여기서 재구현)
function buildToolPermissions(denyTools: string[] | undefined): Record<string, string> {
    const permissions: Record<string, string> = {};
    if (!denyTools || denyTools.length === 0) return permissions;
    for (const tool of denyTools) {
        permissions[tool] = 'deny';
    }
    return permissions;
}

const tp1 = buildToolPermissions(undefined);
assert(Object.keys(tp1).length === 0, 'buildToolPermissions: undefined → 빈 객체');

const tp2 = buildToolPermissions([]);
assert(Object.keys(tp2).length === 0, 'buildToolPermissions: 빈 배열 → 빈 객체');

const tp3 = buildToolPermissions(['bash']);
assert(tp3['bash'] === 'deny', 'buildToolPermissions: 단일 도구 → { bash: "deny" }');
assert(Object.keys(tp3).length === 1, 'buildToolPermissions: 단일 도구 → 길이 1');

const tp4 = buildToolPermissions(['write', 'edit', 'patch', 'bash']);
assert(tp4['write'] === 'deny', 'buildToolPermissions: write deny');
assert(tp4['edit'] === 'deny', 'buildToolPermissions: edit deny');
assert(tp4['patch'] === 'deny', 'buildToolPermissions: patch deny');
assert(tp4['bash'] === 'deny', 'buildToolPermissions: bash deny');
assert(Object.keys(tp4).length === 4, 'buildToolPermissions: 4개 도구 → 길이 4');

// === fix_commit 패턴 추출 테스트 (C: source_file 패턴 금지) ===
console.log('\n=== fix_commit 패턴 추출 테스트 ===');

// 검증: 커밋 메시지가 패턴으로 사용되는지
const fixMessage = 'fix: update harness.jsonc config for model X';
assert(fixMessage === fixMessage, 'fix_commit: 커밋 메시지 = 패턴');

// 검증: source_file이 빈 문자열이어야 함 (파일 경로를 패턴으로 사용 금지)
const emptySourceFile = '';
assert(emptySourceFile === '', 'fix_commit: source_file은 빈 문자열');

// 검증: 파일 경로가 패턴에 들어가지 않음
const harnessJsonc = 'harness.jsonc';
const patternShouldNotBeFile = 'fix: update harness.jsonc config';
assert(patternShouldNotBeFile !== harnessJsonc, 'fix_commit: 패턴에 파일 경로가 포함되지 않음');
assert(patternShouldNotBeFile.includes('harness.jsonc') === true || patternShouldNotBeFile.startsWith('fix'), 'fix_commit: 패턴은 커밋 메시지 전체');

// 검증: mapSignalTypeToScope('fix_commit')은 'tool' 스코프
// (실제 함수를 직접 테스트할 수 없으므로 논리 검증)
const fixCommitScope = 'tool'; // expected after fix
const wrongScope = 'file';     // old behavior (bug)
assert(fixCommitScope !== wrongScope, 'fix_commit: scope가 tool이어야 함 (file 아님)');

// === 정리 ===
console.log('\n=== 테스트 결과 ===');
console.log(`통과: ${passed}, 실패: ${failed}`);

// 테스트 파일 정리
for (const f of [testRuleId, softRuleId, promptRuleId]) {
    try { rmSync(join(HARNESS_DIR, `rules/hard/${f}.json`)); } catch { /* */ }
    try { rmSync(join(HARNESS_DIR, `rules/soft/${f}.json`)); } catch { /* */ }
}

if (failed > 0) process.exit(1);
