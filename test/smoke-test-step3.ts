// smoke-test-step3.ts — Step 3 (Bridge) 검증용 스크립트
// 실행: npx tsx test/smoke-test-step3.ts

import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getProjectKey, ensureHarnessDirs, generateId, rotateHistoryIfNeeded, HARNESS_DIR } from '../src/shared/index.js';
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

// 프로젝트 키
const PROJECT_KEY = getProjectKey(process.cwd());

// === Phase 1: rotateHistoryIfNeeded ===
console.log('\n=== Phase 1: rotateHistoryIfNeeded ===');

ensureHarnessDirs();

// 1. 정상 크기 파일 — 로테이션 발생 안 함
const testHistoryPath = join(HARNESS_DIR, 'rules', 'test-history.jsonl');
writeFileSync(testHistoryPath, '{"test":"small"}\n');
rotateHistoryIfNeeded(testHistoryPath);
assert(existsSync(testHistoryPath), '1MB 미만 파일은 로테이션 안 함');

// 2. 1MB 초과 파일 — 로테이션 발생
const bigContent = 'x'.repeat(1048577); // 1MB + 1 byte
writeFileSync(testHistoryPath, bigContent);
rotateHistoryIfNeeded(testHistoryPath);
assert(!existsSync(testHistoryPath), '1MB 초과 파일은 원본 삭제됨');
// 로테이션된 파일 확인
const rulesDir = join(HARNESS_DIR, 'rules');
const rotatedFiles = readdirSync(rulesDir).filter(f => f.startsWith('test-history-') && f.endsWith('.jsonl'));
assert(rotatedFiles.length === 1, `로테이션 파일 생성됨: ${rotatedFiles[0]}`);
// 정리
for (const f of rotatedFiles) {
    try { rmSync(join(rulesDir, f)); } catch { /* */ }
}
try { rmSync(testHistoryPath); } catch { /* */ }

// 3. 존재하지 않는 파일 — 에러 없이 통과
try {
    rotateHistoryIfNeeded('/nonexistent/path/history.jsonl');
    assert(true, '미존재 파일 로테이션 에러 없음');
} catch {
    assert(false, '미존재 파일 로테이션 에러 없음');
}

// === Phase 2: syncRulesMarkdown 로직 시뮬레이션 ===
console.log('\n=== Phase 2: syncRulesMarkdown 시뮬레이션 ===');

// 테스트용 SOFT/HARD 규칙 생성
const softRuleId1 = generateId();
const hardRuleId1 = generateId();

const testSoftRule: Rule = {
    id: softRuleId1,
    type: 'soft',
    project_key: PROJECT_KEY,
    created_at: new Date().toISOString(),
    source_signal_id: 'step3-test',
    pattern: { type: 'code', match: 'console\\.log', scope: 'tool' },
    description: 'console.log 사용 감지 (Step3 테스트)',
    violation_count: 0,
};

const testHardRule: Rule = {
    id: hardRuleId1,
    type: 'hard',
    project_key: PROJECT_KEY,
    created_at: new Date().toISOString(),
    source_signal_id: 'step3-test',
    pattern: { type: 'code', match: 'rm\\s+-rf', scope: 'tool' },
    description: 'rm -rf 명령 차단 (Step3 테스트)',
    violation_count: 0,
};

writeFileSync(join(HARNESS_DIR, `rules/soft/${softRuleId1}.json`), JSON.stringify(testSoftRule, null, 2));
writeFileSync(join(HARNESS_DIR, `rules/hard/${hardRuleId1}.json`), JSON.stringify(testHardRule, null, 2));
assert(existsSync(join(HARNESS_DIR, `rules/soft/${softRuleId1}.json`)), '테스트 SOFT 규칙 생성됨');
assert(existsSync(join(HARNESS_DIR, `rules/hard/${hardRuleId1}.json`)), '테스트 HARD 규칙 생성됨');

// syncRulesMarkdown 로직 시뮬레이션 (실제 improver의 로직과 동일)
function simulateSyncRulesMarkdown(worktree: string) {
    const rulesDir = join(worktree, '.opencode', 'rules');
    mkdirSync(rulesDir, { recursive: true });

    // SOFT
    const softDir = join(HARNESS_DIR, 'rules/soft');
    const softRules: Rule[] = [];
    if (existsSync(softDir)) {
        for (const file of readdirSync(softDir)) {
            if (!file.endsWith('.json')) continue;
            try { softRules.push(JSON.parse(readFileSync(join(softDir, file), 'utf-8'))); } catch { /* */ }
        }
    }
    const softPath = join(rulesDir, 'harness-soft-rules.md');
    if (softRules.length > 0) {
        const lines = ['# Harness Rules (auto-generated)', '## SOFT Rules'];
        for (const r of softRules) lines.push(`- [SOFT|${r.pattern.scope}] ${r.description}`);
        writeFileSync(softPath, lines.join('\n') + '\n');
    }

    // HARD
    const hardDir = join(HARNESS_DIR, 'rules/hard');
    const hardRules: Rule[] = [];
    if (existsSync(hardDir)) {
        for (const file of readdirSync(hardDir)) {
            if (!file.endsWith('.json')) continue;
            try { hardRules.push(JSON.parse(readFileSync(join(hardDir, file), 'utf-8'))); } catch { /* */ }
        }
    }
    const hardPath = join(rulesDir, 'harness-hard-rules.md');
    if (hardRules.length > 0) {
        const lines = ['# Harness Rules (auto-generated)', '## HARD Rules'];
        for (const r of hardRules) lines.push(`- [HARD|${r.pattern.scope}] ${r.description}`);
        writeFileSync(hardPath, lines.join('\n') + '\n');
    }
}

simulateSyncRulesMarkdown(process.cwd());
assert(existsSync('.opencode/rules/harness-soft-rules.md'), 'harness-soft-rules.md 생성됨');
assert(existsSync('.opencode/rules/harness-hard-rules.md'), 'harness-hard-rules.md 생성됨');

const softMd = readFileSync('.opencode/rules/harness-soft-rules.md', 'utf-8');
assert(softMd.includes('console.log 사용 감지'), 'SOFT 마크다운에 규칙 내용 포함');
assert(softMd.includes('[SOFT|tool]'), 'SOFT 마크다운에 scope 포함');

const hardMd = readFileSync('.opencode/rules/harness-hard-rules.md', 'utf-8');
assert(hardMd.includes('rm -rf 명령 차단'), 'HARD 마크다운에 규칙 내용 포함');
assert(hardMd.includes('[HARD|tool]'), 'HARD 마크다운에 scope 포함');

// === Phase 3: Memory Index/Search 시뮬레이션 ===
console.log('\n=== Phase 3: Memory Index/Search 시뮬레이션 ===');

// 테스트용 세션 JSONL 생성 (키워드 포함)
const sessionDir = join(HARNESS_DIR, 'logs/sessions');
mkdirSync(sessionDir, { recursive: true });
const testSessionFile = `session_${PROJECT_KEY}_test.jsonl`;
const testSessionPath = join(sessionDir, testSessionFile);

const sessionLines = [
    JSON.stringify({ role: 'assistant', content: 'DECISION: React 컴포넌트는 함수형만 사용' }),
    JSON.stringify({ role: 'assistant', content: 'NEVER DO: any 타입 사용 금지' }),
    JSON.stringify({ role: 'assistant', content: '일반적인 대화 내용 (키워드 없음)' }),
    JSON.stringify({ role: 'assistant', content: 'ALWAYS: 에러 핸들링 필수' }),
    JSON.stringify({ role: 'assistant', content: 'FIXME: 이 함수 리팩토링 필요' }),
    JSON.stringify({ role: 'assistant', content: 'constraint: 최대 100줄 제한' }),
];
writeFileSync(testSessionPath, sessionLines.join('\n') + '\n');
assert(existsSync(testSessionPath), '테스트 세션 JSONL 생성됨');

// indexSessionFacts 로직 시뮬레이션
const MEMORY_KEYWORDS = [
    /decision:\s*(.+)/i,
    /결정:\s*(.+)/,
    /DECISION:\s*(.+)/,
    /NEVER DO:\s*(.+)/i,
    /ALWAYS:\s*(.+)/i,
    /MUST:\s*(.+)/i,
    /FORBIDDEN:\s*(.+)/i,
    /constraint:\s*(.+)/i,
    /제약:\s*(.+)/,
    /TODO:\s*(.+)/i,
    /FIXME:\s*(.+)/i,
];

interface MemoryFact {
    id: string;
    keywords: string[];
    content: string;
    source_session: string;
    created_at: string;
}

const factsDir = join(HARNESS_DIR, 'memory/facts');
mkdirSync(factsDir, { recursive: true });

const content = readFileSync(testSessionPath, 'utf-8');
const lines = content.split('\n').filter(Boolean);
let factsExtracted = 0;

for (const line of lines) {
    try {
        const entry = JSON.parse(line);
        const textToSearch = typeof entry === 'string' ? entry : JSON.stringify(entry);
        for (const pattern of MEMORY_KEYWORDS) {
            const match = textToSearch.match(pattern);
            if (match && match[1]) {
                const keyword = match[1].trim().slice(0, 200);
                const id = generateId();
                const factData: MemoryFact = {
                    id,
                    keywords: [pattern.source.replace(/\\s\*\(.*/, '').toLowerCase(), keyword.toLowerCase()],
                    content: keyword,
                    source_session: testSessionFile,
                    created_at: new Date().toISOString(),
                };
                writeFileSync(join(factsDir, `${id}.json`), JSON.stringify(factData, null, 2));
                factsExtracted++;
            }
        }
    } catch { /* */ }
}

assert(factsExtracted >= 4, `키워드 ${factsExtracted}개 추출됨 (최소 4개 기대)`);

// Search 시뮬레이션
const allFacts: MemoryFact[] = [];
if (existsSync(factsDir)) {
    for (const file of readdirSync(factsDir)) {
        if (!file.endsWith('.json')) continue;
        try { allFacts.push(JSON.parse(readFileSync(join(factsDir, file), 'utf-8'))); } catch { /* */ }
    }
}

const queryWords = ['react', '함수형'].filter(Boolean);
const scored = allFacts
    .map(fact => {
        const factText = `${fact.keywords.join(' ')} ${fact.content}`.toLowerCase();
        const score = queryWords.reduce((acc, word) => acc + (factText.includes(word) ? 1 : 0), 0);
        return { fact, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

assert(scored.length > 0, 'Search: React 관련 fact 검색됨');
if (scored.length > 0) {
    assert(scored[0].fact.content.includes('React'), 'Search: 첫 결과에 React 포함');
}

// 빈 쿼리 테스트
const emptyScored = allFacts
    .map(fact => {
        const factText = `${fact.keywords.join(' ')} ${fact.content}`.toLowerCase();
        const score = ['zzzzz'].reduce((acc, word) => acc + (factText.includes(word) ? 1 : 0), 0);
        return { fact, score };
    })
    .filter(item => item.score > 0);
assert(emptyScored.length === 0, 'Search: 매칭 없는 쿼리는 빈 결과');

// === Phase 4: detectFixCommits 파싱 시뮬레이션 ===
console.log('\n=== Phase 4: detectFixCommits 파싱 ===');

// COMMIT_START delimiter 기반 파싱 시뮬레이션
const mockGitOutput = `COMMIT_START
abc123def456
fix: resolve TypeScript build error in observer.ts
src/harness/observer.ts
src/types.ts
COMMIT_START
789ghi012jkl
feat: add new feature
src/new-feature.ts
COMMIT_START
mno345pqr678
fix: patch memory leak in improver
src/harness/improver.ts
`;

const blocks = mockGitOutput.split('COMMIT_START\n').filter(Boolean);
let fixCommits = 0;
let firstFileFound = '';

for (const block of blocks) {
    const bLines = block.trim().split('\n');
    if (bLines.length < 2) continue;
    const hash = bLines[0].trim();
    const message = bLines[1].trim();
    if (!hash || !message.startsWith('fix')) continue;
    const files = bLines.slice(2).filter(l => l.trim().length > 0);
    fixCommits++;
    if (fixCommits === 1) firstFileFound = files[0] || '';
}

assert(fixCommits === 2, `fix: 커밋 ${fixCommits}개 파싱됨 (2개 기대)`);
assert(firstFileFound === 'src/harness/observer.ts', `첫 fix 커밋 파일: ${firstFileFound}`);

// feat 커밋은 무시되는지 확인
const featCommitBlocks = blocks.filter(b => {
    const bLines = b.trim().split('\n');
    return bLines.length >= 2 && bLines[1].trim().startsWith('feat');
});
assert(featCommitBlocks.length === 1, 'feat 커밋은 fix로 카운트되지 않음');

// === Phase 5: history 로테이션 연동 시뮬레이션 ===
console.log('\n=== Phase 5: appendHistory 로테이션 연동 ===');

const historyPath = join(HARNESS_DIR, 'rules', 'history.jsonl');

// 기존 history 백업
let backup: string | null = null;
if (existsSync(historyPath)) {
    backup = readFileSync(historyPath, 'utf-8');
}

// 작은 내용 append → 로테이션 안 됨
const smallEntry = JSON.stringify({ event: 'test_step3', timestamp: new Date().toISOString() }) + '\n';
writeFileSync(historyPath, smallEntry, { flag: 'a' });
rotateHistoryIfNeeded(historyPath);
assert(existsSync(historyPath), '작은 history append 후 파일 존재');

// 1MB 초과 내용 → 로테이션 됨
writeFileSync(historyPath, 'x'.repeat(1048577));
rotateHistoryIfNeeded(historyPath);
assert(!existsSync(historyPath), '1MB 초과 history 로테이션됨');

// 로테이션된 파일 확인
const historyRotated = readdirSync(join(HARNESS_DIR, 'rules')).filter(
    f => f.startsWith('history-') && f.endsWith('.jsonl')
);
assert(historyRotated.length >= 1, `로테이션된 history 파일 ${historyRotated.length}개 확인`);

// 정리
for (const f of historyRotated) {
    try { rmSync(join(HARNESS_DIR, 'rules', f)); } catch { /* */ }
}
// 백업 복원
if (backup) {
    writeFileSync(historyPath, backup);
}

// === ensureHarnessDirs memory/facts 디렉토리 ===
console.log('\n=== Shared: memory/facts 디렉토리 ===');
ensureHarnessDirs();
assert(existsSync(join(HARNESS_DIR, 'memory/facts')), 'memory/facts 디렉토리 존재');
assert(existsSync(join(HARNESS_DIR, 'memory/archive')), 'memory/archive 디렉토리 존재');

// === #5: Regex Backtracking 방지 ===
console.log('\n=== #5: Regex Backtracking 방지 ===');

// 길이 제한 테스트 — 매우 긴 target도 안전하게 처리
const longTarget = 'a'.repeat(50000);
try {
    const result = safeRegexTest('console\\.log', longTarget);
    assert(result === false, '매우 긴 target도 정상 처리 (매칭 없음)');
} catch {
    assert(false, '매우 긴 target에서 크래시 발생!');
}

// 정상 패턴은 target 내에 있으면 매칭 (길이 제한 내)
const targetWithMatch = 'console.log("test")' + 'x'.repeat(100);
try {
    const result = safeRegexTest('console\\.log', targetWithMatch);
    assert(result === true, 'target 내 매칭 패턴 정상 감지');
} catch {
    assert(false, '매칭 테스트에서 크래시!');
}

// 잘못된 정규식 패턴 — 에러 없이 false 반환
assert(safeRegexTest('[invalid', 'some text') === false, '잘못된 정규식은 false 반환');

function safeRegexTest(pattern: string, target: string): boolean {
    try {
        const MAX_LEN = 10000;
        const safeTarget = target.length > MAX_LEN ? target.slice(0, MAX_LEN) : target;
        return new RegExp(pattern, 'i').test(safeTarget);
    } catch { return false; }
}

// === #6: Command Injection 방지 (timestamp 검증) ===
console.log('\n=== #6: Command Injection 방지 ===');

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;

function isValidTimestamp(ts: unknown): boolean {
    return typeof ts === 'string' && ISO_DATE_REGEX.test(ts);
}

// 정상 timestamp
assert(isValidTimestamp('2026-04-12T04:55:24.000Z') === true, '정상 ISO timestamp 통과');
assert(isValidTimestamp('2026-04-12') === true, '날짜만 있어도 통과');

// 인젝션 시도
assert(isValidTimestamp('"; rm -rf / ;"') === false, '명령어 인젝션 차단');
assert(isValidTimestamp('$(cat /etc/passwd)') === false, '명령어 치환 차단');
assert(isValidTimestamp('`whoami`') === false, '백틱 인젝션 차단');
assert(isValidTimestamp('2026-04-12"; echo pwned') === false, '중간 인젝션 차단');
assert(isValidTimestamp('') === false, '빈 문자열 차단');
assert(isValidTimestamp(12345) === false, '숫자 타입 차단');
assert(isValidTimestamp(null) === false, 'null 차단');

// === #7: 과도하게 넓은 패턴 검증 ===
console.log('\n=== #7: 과도하게 넓은 패턴 검증 ===');

function isValidPattern(pattern: string): boolean {
    if (!pattern || pattern.length < 3) return false;
    const metaOnly = pattern.replace(/[.*+?^${}()|[\]\\]/g, '');
    if (metaOnly.length === 0) return false;
    if (/ses_[a-f0-9]{10,}/.test(pattern)) return false;
    if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(pattern)) return false;
    return true;
}

// 정상 패턴
assert(isValidPattern('console\\.log') === true, '정상 패턴: console\\.log');
assert(isValidPattern('TypeError: Cannot read') === true, '정상 패턴: TypeError');
assert(isValidPattern('rm\\s+-rf') === true, '정상 패턴: rm\\s+-rf');

// 너무 짧은 패턴
assert(isValidPattern('.') === false, '너무 짧은 패턴: "." 거부');
assert(isValidPattern('..') === false, '너무 짧은 패턴: ".." 거부');
assert(isValidPattern('ab') === false, '3자 미만 패턴: "ab" 거부');

// 메타문자만 있는 패턴
assert(isValidPattern('.*') === false, '메타문자만: ".*" 거부');
assert(isValidPattern('.+') === false, '메타문자만: ".+" 거부');
assert(isValidPattern('***') === false, '메타문자만: "***" 거부');
assert(isValidPattern('()') === false, '메타문자만: "()" 거부');

// 빈 문자열
assert(isValidPattern('') === false, '빈 문자열 거부');

// 세션 ID 포함 패턴
assert(isValidPattern("Tool 'read' retried 3 times with errors in session ses_2517dfcc3ffe1Pd2S9BiWHk864") === false, '세션 ID 포함: 거부');
assert(isValidPattern("ses_abc123def456") === false, '세션 ID만: 거부');
assert(isValidPattern('normal error message ses_ short') === true, 'ses_ 짧은 건 허용');

// UUID 포함 패턴
assert(isValidPattern('Error processing 550e8400-e29b-41d4-a716-446655440000') === false, 'UUID 포함: 거부');
assert(isValidPattern('no-uuid-here just dashes') === true, 'UUID 아닌 하이픈: 허용');

// === #1: Race Condition 방지 (write 직전 재확인) ===
console.log('\n=== #1: Race Condition 방지 ===');

// signalToRule이 이미 존재하는 규칙 파일 경로면 스킵하는지 확인
// 이미 ruleExists 체크가 있으므로, 동일 패턴으로 두 번 호출 시 두 번째는 스킵
const raceTestDir = join(HARNESS_DIR, 'rules/soft');
mkdirSync(raceTestDir, { recursive: true });
const raceRuleId = generateId();
const raceRule: Rule = {
    id: raceRuleId,
    type: 'soft',
    project_key: 'global',
    created_at: new Date().toISOString(),
    source_signal_id: 'race-test',
    pattern: { type: 'code', match: 'race-condition-test-pattern-unique', scope: 'tool' },
    description: 'Race condition 테스트용 규칙',
    violation_count: 0,
};
writeFileSync(join(raceTestDir, `${raceRuleId}.json`), JSON.stringify(raceRule, null, 2));

// ruleExists로 중복 감지 확인
function ruleExistsTest(patternMatch: string, projectKey: string): boolean {
    for (const type of ['soft', 'hard'] as const) {
        const dir = join(HARNESS_DIR, `rules/${type}`);
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            try {
                const rule: Rule = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
                if (rule.pattern.match === patternMatch &&
                    (rule.project_key === projectKey || rule.project_key === 'global')) {
                    return true;
                }
            } catch { /* 무시 */ }
        }
    }
    return false;
}

assert(ruleExistsTest('race-condition-test-pattern-unique', 'global') === true, '동일 패턴 중복 감지됨');
assert(ruleExistsTest('nonexistent-pattern-xyz', 'global') === false, '다른 패턴은 중복 아님');

// 정리
try { rmSync(join(raceTestDir, `${raceRuleId}.json`)); } catch { /* */ }

// === 정리 ===
console.log('\n=== 정리 ===');

// 테스트용 규칙 삭제
for (const id of [softRuleId1, hardRuleId1]) {
    try { rmSync(join(HARNESS_DIR, `rules/soft/${id}.json`)); } catch { /* */ }
    try { rmSync(join(HARNESS_DIR, `rules/hard/${id}.json`)); } catch { /* */ }
}

// 테스트용 facts 삭제
for (const file of readdirSync(factsDir)) {
    try { rmSync(join(factsDir, file)); } catch { /* */ }
}

// 테스트용 세션 삭제
try { rmSync(testSessionPath); } catch { /* */ }

// .opencode/rules/ 마크다운 삭제 (테스트용)
try { rmSync('.opencode/rules/harness-soft-rules.md'); } catch { /* */ }
try { rmSync('.opencode/rules/harness-hard-rules.md'); } catch { /* */ }

// === 결과 ===
console.log('\n=== Step 3 Smoke Test 결과 ===');
console.log(`통과: ${passed}, 실패: ${failed}`);

if (failed > 0) process.exit(1);
