// 매뉴얼 시트 어댑터 단위 테스트 — 실샘플 2종 패턴 고정
// 파일 A: [SCM] TC 목록 (단일 헤더·결과 컬럼 1개·N/A 다수·반복 헤더)
// 파일 B: PARAMETA v3.1 (표지행·2단 병합 헤더·환경×테스터 다중 결과 컬럼)
const { test } = require('node:test');
const assert = require('node:assert');
const adapter = require('../lib/adapters/manual-sheet');

// ── 픽스처 — GSheet values.get 원본 형태 ({시트명: rows[][]}, 병합 셀은 좌상단만 값) ──

// 파일 A 패턴
const FILE_A = {
  'TC 목록': [
    ['TC ID', '대분류', '소분류', '중요도', '자동화 상태', '테스트 통과'],
    ['SCM-TRAD-001', 'Trade', '탭 네비게이션', '높음', 'IMPLEMENTED', 'Pass'],
    ['SCM-TRAD-002', 'Trade', '레이아웃', '보통', 'NOT_REVIEWED', 'N/A'],
    ['TC ID', '대분류', '소분류', '중요도', '자동화 상태', '테스트 통과'], // 반복 헤더
    ['SCM-TRAD-003', 'Trade', '스켈레톤', '보통', 'NOT_REVIEWED', 'Fail'],
    ['SCM-TRAD-004', 'Trade', '배지', '낮음', 'IMPLEMENTED', 'N/T'],
    ['', '', '소계', '', '', ''], // 소계 행 — TC ID 없음
  ],
};

// 파일 B 패턴 — 표지행 + 헤더(TC ID·환경) + 서브 헤더(테스터)
const FILE_B = {
  '요약': [
    ['No.', '항목', 'Case 수', '특징'],
    ['1', '거래소 연동', '12', 'PortX'],
  ],
  'Trade': [
    ['Trade 영역 테스트', '', '', '', ''],            // 표지행
    ['TC ID', '소분류', '거래소', 'Win/MAC', 'MAC'],   // 헤더 (병합 상단)
    ['', '', '', 'Tester 1', 'Tester 2'],             // 서브 헤더 (TC ID 빈값)
    ['SC-TRD-FTPS-034', 'Liq. Price', '', 'Pass', 'Pass'],
    ['SC-TRD-FTPS-106', 'TP Limit', 'HL, BG, GT', 'Pass', 'N/T'],
    ['SC-TRD-FTPS-107', 'SL Limit', 'HL, BG, GT', 'Fail', 'Pass'],
    ['SC-TRD-FTPS-108', '범위 외', '', 'N/A', 'N/A'],
  ],
};

// ── 시트 채택 (D2) ──────────────────────────────────────────────────────

test('파일 A — 시트 채택, 반복 헤더·소계 행 배제, TC당 1 레코드', () => {
  const { rows, detected } = adapter.parse(FILE_A);
  assert.equal(detected.sheets.length, 1);
  assert.equal(detected.sheets[0].adopted, true);
  assert.equal(rows.length, 4); // 유효 TC 4건 (반복 헤더·소계 제외)
  assert.deepEqual(rows.map(r => r.tcId).sort(),
    ['SCM-TRAD-001', 'SCM-TRAD-002', 'SCM-TRAD-003', 'SCM-TRAD-004']);
});

test('파일 B — 요약 시트 자동 배제, TC 시트만 채택', () => {
  const { detected } = adapter.parse(FILE_B);
  const summary = detected.sheets.find(s => s.name === '요약');
  const trade = detected.sheets.find(s => s.name === 'Trade');
  assert.equal(summary.adopted, false);
  assert.equal(trade.adopted, true);
  assert.equal(trade.rowCount, 4);
});

test('supports — 유효 시트 true, 결과 컬럼 없는 데이터 false', () => {
  assert.equal(adapter.supports(FILE_A), true);
  assert.equal(adapter.supports({ 잡동사니: [['a', 'b'], ['1', '2']] }), false);
});

// ── 다단 헤더 라벨 (파일 B) ─────────────────────────────────────────────

test('파일 B — 환경×테스터 라벨 조합 (Win/MAC-Tester 1)', () => {
  const { rows, detected } = adapter.parse(FILE_B);
  const trade = detected.sheets.find(s => s.name === 'Trade');
  assert.deepEqual(trade.resultLabels, ['Win/MAC-Tester 1', 'MAC-Tester 2']);
  const r = rows.find(x => x.tcId === 'SC-TRD-FTPS-106');
  assert.deepEqual(r.envResults, [
    { env: 'Win/MAC-Tester 1', result: 'Pass' },
    { env: 'MAC-Tester 2', result: 'N/T' },
  ]);
});

// ── 대표값 합산 (D3) ────────────────────────────────────────────────────

test('D3 — Pass+N/T → Pass (실행값 우선)', () => {
  const r = adapter.parse(FILE_B).rows.find(x => x.tcId === 'SC-TRD-FTPS-106');
  assert.equal(r.result, 'Pass');
});

test('D3 — Fail+Pass → Fail (Fail 우선)', () => {
  const r = adapter.parse(FILE_B).rows.find(x => x.tcId === 'SC-TRD-FTPS-107');
  assert.equal(r.result, 'Fail');
});

test('D3 — 전 환경 N/A 일 때만 N/A', () => {
  const r = adapter.parse(FILE_B).rows.find(x => x.tcId === 'SC-TRD-FTPS-108');
  assert.equal(r.result, 'N/A');
  assert.equal(adapter.representative(['N/A', 'Pass']), 'Pass');
  assert.equal(adapter.representative(['N/A', 'N/T']), 'N/T');
});

// ── 플랫폼 유도 (D4) ────────────────────────────────────────────────────

test('D4 — 프리픽스 → 플랫폼 (SC-/SCM-/미등록)', () => {
  assert.equal(adapter.platformOf('SC-TRD-FTPS-034'), 'pc-web');
  assert.equal(adapter.platformOf('SCM-TRAD-001'), 'mobile-web');
  assert.equal(adapter.platformOf('ZZZ-AAA-001'), 'ZZZ');
  const { detected } = adapter.parse(FILE_A);
  assert.deepEqual(detected.platforms, ['mobile-web']);
});

// ── 결과 어휘 ───────────────────────────────────────────────────────────

test('결과 분류 — N/A·Blocked·한국어 어휘', () => {
  assert.equal(adapter.classify('N/A'), 'N/A');
  assert.equal(adapter.classify('해당없음'), 'N/A');
  assert.equal(adapter.classify('Blocked'), 'Blocked');
  assert.equal(adapter.classify('통과'), 'Pass');
  assert.equal(adapter.classify('보류'), 'N/T');
  assert.equal(adapter.classify(''), null);
  assert.equal(adapter.classify('아무말'), null);
});

// ── 시트 간 같은 TC 병합 ────────────────────────────────────────────────

test('같은 TC 가 여러 시트에 있으면 envResults 병합 후 대표값 재계산', () => {
  const input = {
    'A 시트': [
      ['TC ID', '항목', '결과'],
      ['SC-TRD-X-001', 'a', 'Pass'],
      ['SC-TRD-X-002', 'b', 'Pass'],
      ['SC-TRD-X-003', 'c', 'Pass'],
    ],
    'B 시트': [
      ['TC ID', '항목', '결과'],
      ['SC-TRD-X-001', 'a', 'Fail'],
      ['SC-TRD-X-004', 'd', 'Pass'],
      ['SC-TRD-X-005', 'e', 'Pass'],
    ],
  };
  const { rows } = adapter.parse(input);
  const merged = rows.find(r => r.tcId === 'SC-TRD-X-001');
  assert.equal(merged.envResults.length, 2);
  assert.equal(merged.result, 'Fail'); // Fail 우선
  assert.equal(merged.sheet, 'A 시트, B 시트');
});
