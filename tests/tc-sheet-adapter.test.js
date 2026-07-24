// TC 양식 어댑터 (test-run R1) 테스트
const test = require('node:test');
const assert = require('node:assert');
const adapter = require('../lib/adapters/tc-sheet');

// SCM 모바일 TC 시트 실물 컬럼 구성 (plan §TC 양식)
const HEADER = ['TC ID', '대분류', '중분류', '소분류', '사전조건', '테스트 스텝', '기대결과', '중요도',
  '대상 거래소', 'smoke', '화면코드', 'Program IDs', 'Coverage %', 'Coverage 메모', '자동화 상태'];

function sampleAllData() {
  return {
    'TC 목록': [
      HEADER,
      ['SCM-TRD-001', '거래', '레버리지', '0x 입력', '로그인 상태', '1. 입력\n2. 확인', '에러 노출', '높음',
        'Binance, BingX', 'TRUE', 'TRD-01', 'P-100', '80%', '부분 자동화', 'IMPLEMENTED'],
      ['SCM-TRD-002', '', '', '최대값 입력', '', '1. 입력', '정상 처리', '중',
        '', 'FALSE', '', '', '', '', 'NOT_REVIEWED'],
      ['소계', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ],
    '요약': [['항목', '값'], ['전체', '2']],
  };
}

test('TC 양식 감지 — TC ID 컬럼이 있는 시트만 채택, 요약 시트 배제', () => {
  assert.equal(adapter.supports(sampleAllData()), true);
  const { detected } = adapter.parse(sampleAllData());
  const adopted = detected.sheets.filter(s => s.adopted).map(s => s.name);
  assert.deepEqual(adopted, ['TC 목록']);
});

test('TC 행 파싱 — 문서 컬럼·신규 수집 컬럼·병합 셀 분류 이어받기', () => {
  const { tcs } = adapter.parse(sampleAllData());
  assert.equal(tcs.length, 2); // 소계 행 배제

  const t1 = tcs[0];
  assert.equal(t1.tcId, 'SCM-TRD-001');
  assert.equal(t1.title, '0x 입력');
  assert.equal(t1.category1, '거래');
  assert.equal(t1.precondition, '로그인 상태');
  assert.equal(t1.priority, 'High');
  assert.deepEqual(t1.targetExchanges, ['Binance', 'BingX']);
  assert.equal(t1.smoke, true);
  assert.equal(t1.coveragePct, 80);
  assert.equal(t1.automation, 'IMPLEMENTED');
  assert.equal(t1.platform, 'mobile-web'); // SCM- 프리픽스

  const t2 = tcs[1];
  assert.equal(t2.category1, '거래');        // 병합 셀 이어받기
  assert.equal(t2.category2, '레버리지');
  assert.equal(t2.priority, 'Medium');
  assert.deepEqual(t2.targetExchanges, []);  // 거래소 공란 허용
  assert.equal(t2.smoke, false);
  assert.equal(t2.coveragePct, null);
});

test('tcId 중복은 첫 행 우선', () => {
  const data = {
    S: [HEADER,
      ['SC-A-001', '', '', '첫번째', '', '1. 스텝', '기대', '', '', '', '', '', '', '', ''],
      ['SC-A-001', '', '', '두번째', '', '1. 스텝', '기대', '', '', '', '', '', '', '', '']],
  };
  const { tcs } = adapter.parse(data);
  assert.equal(tcs.length, 1);
  assert.equal(tcs[0].title, '첫번째');
});

test('parseCoverage — %, 정수, 비율 소수, 범위 클램프', () => {
  assert.equal(adapter.parseCoverage('80%'), 80);
  assert.equal(adapter.parseCoverage('100'), 100);
  assert.equal(adapter.parseCoverage('0.8'), 80);
  assert.equal(adapter.parseCoverage('1'), 1);      // 정수 1 은 1% (소수점 없으면 비율 아님)
  assert.equal(adapter.parseCoverage('150'), 100);
  assert.equal(adapter.parseCoverage(''), null);
  assert.equal(adapter.parseCoverage('미정'), null);
});

test('결과 컬럼 없는 TC 시트도 채택 — 단, 스텝/기대결과 상세는 있어야 함', () => {
  // 결과(Pass/Fail) 컬럼은 없어도 되지만(매뉴얼 결과 어댑터와의 차이),
  // 실제 케이스 상세(스텝 또는 기대결과)는 있어야 테스트 시트로 인정한다.
  const data = { S: [['TC ID', '소분류', '테스트 스텝'], ['SC-B-001', '케이스', '1. 실행']] };
  assert.equal(adapter.supports(data), true);
});

test('③ 상세 없는 시트 배제 — TC ID·제목만 있고 스텝·기대결과가 전부 빈 시트(목차성)', () => {
  const data = { S: [['TC ID', '소분류'], ['SC-C-001', '항목1'], ['SC-C-002', '항목2']] };
  assert.equal(adapter.supports(data), false);
  const { detected, tcs } = adapter.parse(data);
  assert.equal(tcs.length, 0);
  assert.equal(detected.sheets[0].adopted, false);
  assert.match(detected.sheets[0].reason, /상세/);
});

test('① 비테스트 시트명 배제 — 목차·시트14는 TC ID·상세가 있어도 제외', () => {
  const withDetail = (id) => [id, '', '', '제목', '', '1. 스텝', '기대', '', '', '', '', '', '', '', ''];
  const data = {
    '목차': [HEADER, withDetail('SC-TOC-001'), withDetail('SC-TOC-002')],
    '변경이력': [HEADER, withDetail('SC-HIS-001')],
    'PC웹': [HEADER, withDetail('SC-PC-001')],
  };
  const { detected, tcs } = adapter.parse(data);
  const adopted = detected.sheets.filter(s => s.adopted).map(s => s.name);
  assert.deepEqual(adopted, ['PC웹']);                    // 목차·변경이력 배제
  assert.ok(tcs.every(t => t.sheet === 'PC웹'));
  const toc = detected.sheets.find(s => s.name === '목차');
  assert.match(toc.reason, /비테스트 시트명/);
});

test('isNonTestSheetName — 목차/표지/변경이력 등 판별', () => {
  ['목차', '차례', 'TOC', '표지', 'Cover', '변경 이력', '개정이력', 'Revision History', '범례', 'Legend', '요약', 'Summary']
    .forEach(n => assert.equal(adapter.isNonTestSheetName(n), true, `${n} 는 비테스트여야`));
  ['PC웹', 'Landing Page', '거래', 'TC 목록', '모바일웹']
    .forEach(n => assert.equal(adapter.isNonTestSheetName(n), false, `${n} 는 테스트 시트여야`));
});
