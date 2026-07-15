// report-stats 단위 테스트 — 실사용 데이터 형태(테스트 통과/테스트 결과 헤더, N/T·N/A 구분) 기반
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyResult, detectResultColumns, computeStatsFromSheetData } = require('../lib/report-stats');

const H = ['TC ID', '대분류', '중분류', '소분류', '기대결과', '테스트 통과'];

function sheet(name, rows, header) {
  return { name, header: header || H, rows };
}

test('classifyResult — pass/fail/nt/na 4분류', () => {
  assert.equal(classifyResult('PASS'), 'pass');
  assert.equal(classifyResult('통과'), 'pass');
  assert.equal(classifyResult('Fail'), 'fail');
  assert.equal(classifyResult('N/T'), 'nt');
  assert.equal(classifyResult('미수행'), 'nt');
  assert.equal(classifyResult('-'), 'nt');
  assert.equal(classifyResult('N/A'), 'na');
  assert.equal(classifyResult('해당 없음'), 'na');
  assert.equal(classifyResult(''), null);
  assert.equal(classifyResult('IMPLEMENTED'), null);
});

test('결과 컬럼 탐지 — "테스트 통과" 부분일치, "기대결과" 제외', () => {
  const rows = [
    ['TC-1', 'A', 'B', 'C', '버튼이 보인다', 'PASS'],
    ['TC-2', 'A', 'B', 'C', '팝업이 뜬다', 'FAIL'],
    ['TC-3', 'A', 'B', 'C', 'PASS 라고 표시', 'N/T'],
  ];
  const cols = detectResultColumns(H, rows);
  assert.deepEqual(cols, [5]); // 기대결과(4)는 제외, 테스트 통과(5)만
});

test('결과 컬럼 탐지 — 긴 텍스트 헤더(차트 시트) 오탐 방지', () => {
  const chartHeader = ['', '', '전체 케이스 기준으로 Order_Result 자동화가 완료되었습니다'];
  const cols = detectResultColumns(chartHeader, [['', '', ''], ['', '', '']]);
  assert.deepEqual(cols, []);
});

test('결과 컬럼 탐지 — 별칭 실패 시 값 프로파일 스캔', () => {
  const header = ['ID', '항목', '확인'];  // '확인' 은 별칭에 없음
  const rows = [
    ['1', 'a', 'PASS'], ['2', 'b', 'FAIL'], ['3', 'c', 'N/T'], ['4', 'd', 'PASS'],
  ];
  assert.deepEqual(detectResultColumns(header, rows), [2]);
});

test('통계 — N/T 와 N/A 분리, N/A 는 모수 제외', () => {
  const rows = [
    ['TC-1', 'A', 'B', 'C', '', 'PASS'],
    ['TC-2', 'A', 'B', 'C', '', 'PASS'],
    ['TC-3', 'A', 'B', 'C', '', 'FAIL'],
    ['TC-4', 'A', 'B', 'C', '', 'N/T'],
    ['TC-5', 'A', 'B', 'C', '', 'N/A'],
    ['TC-6', 'A', 'B', 'C', '', 'N/A'],
    ['', '', '', '', '', 'PASS'],       // TC ID 없는 행 → 제외
  ];
  const r = computeStatsFromSheetData({ sheets: [sheet('S1', rows)] });
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 1);
  assert.equal(r.skip, 1);   // N/T
  assert.equal(r.na, 2);     // N/A 별도
  assert.equal(r.total, 4);  // pass+fail+nt (N/A 제외)
  assert.equal(r.executed, 3);
  assert.equal(r.passRate, 67);
  assert.equal(r.executionRate, 75);
  assert.equal(r.failItems.length, 1);
  assert.deepEqual(r.failItems[0].cells, ['TC-3', 'A', 'B', 'C']);
});

test('통계 — 결과 컬럼 없는 시트(차트 등)는 통계에서 제외', () => {
  const r = computeStatsFromSheetData({
    sheets: [
      sheet('TC', [['TC-1', 'A', 'B', 'C', '', 'PASS']]),
      sheet('차트', [['x', 'y'], ['1', '2']], ['가로', '세로']),
    ],
  });
  assert.equal(r.sheets.length, 1);
  assert.equal(r.pass, 1);
});

test('통계 — 다중 결과 컬럼 (Android/iOS) 각각 카운트', () => {
  const header = ['TC ID', '항목', 'Android', 'iOS'];
  const rows = [
    ['TC-1', 'a', 'PASS', 'FAIL'],
    ['TC-2', 'b', 'PASS', 'N/T'],
  ];
  const r = computeStatsFromSheetData({ sheets: [sheet('멀티', rows, header)] });
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 1);
  assert.equal(r.skip, 1);
  assert.equal(r.total, 4);
});
