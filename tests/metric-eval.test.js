// metric-eval 단위 테스트 — node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateMetric } = require('../lib/metric-eval');

const DATA = {
  sheets: [
    {
      name: 'TC 목록',
      header: ['ID', '자동화상태', '결과'],
      rows: [
        ['TC-1', 'IMPLEMENTED', 'PASS'],
        ['TC-2', 'IMPLEMENTED', 'FAIL'],
        ['TC-3', 'implemented', 'pass'],   // 대소문자 무시 확인
        ['TC-4', 'NOT_YET', 'PASS'],
        ['TC-5', '', ''],                   // 상태 빈 값
        ['', '', ''],                       // 완전 빈 행 → 제외
      ],
    },
  ],
};

test('count: IMPLEMENTED 행 수 (대소문자 무시)', () => {
  const r = evaluateMetric(DATA, {
    label: 'IMPLEMENTED 수', sheet: null,
    filter: [{ col: '자동화상태', op: 'eq', value: 'IMPLEMENTED' }],
    agg: 'count', of: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.numerator, 3);
  assert.equal(r.denominator, 5); // 빈 행 제외한 전체
  assert.equal(r.percent, 60);
});

test('ratio: IMPLEMENTED 중 PASS 비율', () => {
  const r = evaluateMetric(DATA, {
    label: 'IMPLEMENTED 중 Pass', sheet: 'TC 목록',
    filter: [{ col: '자동화상태', op: 'eq', value: 'IMPLEMENTED' }],
    agg: 'ratio', of: [{ col: '결과', op: 'eq', value: 'PASS' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.numerator, 2);
  assert.equal(r.denominator, 3);
  assert.equal(r.percent, 67);
  assert.match(r.display, /67% \(2\/3\)/);
});

test('ratio: filter 빈 배열 = 전체가 분모', () => {
  const r = evaluateMetric(DATA, {
    label: 'IMPLEMENTED 비율', sheet: null,
    filter: [], agg: 'ratio',
    of: [{ col: '자동화상태', op: 'eq', value: 'IMPLEMENTED' }],
  });
  assert.equal(r.numerator, 3);
  assert.equal(r.denominator, 5);
});

test('in / contains / not_empty 연산', () => {
  const rIn = evaluateMetric(DATA, {
    label: '', sheet: null,
    filter: [{ col: '결과', op: 'in', value: ['PASS', 'FAIL'] }],
    agg: 'count', of: [],
  });
  assert.equal(rIn.numerator, 4);

  const rContains = evaluateMetric(DATA, {
    label: '', sheet: null,
    filter: [{ col: '자동화상태', op: 'contains', value: 'IMPLE' }],
    agg: 'count', of: [],
  });
  assert.equal(rContains.numerator, 3);

  const rNotEmpty = evaluateMetric(DATA, {
    label: '', sheet: null,
    filter: [{ col: '자동화상태', op: 'not_empty', value: null }],
    agg: 'count', of: [],
  });
  assert.equal(rNotEmpty.numerator, 4);
});

test('에러: 존재하지 않는 컬럼', () => {
  const r = evaluateMetric(DATA, {
    label: '', sheet: null,
    filter: [{ col: '우선순위', op: 'eq', value: 'P1' }],
    agg: 'count', of: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /컬럼 없음: 우선순위/);
});

test('에러: 존재하지 않는 시트 / 잘못된 agg / ratio 에 of 없음', () => {
  assert.equal(evaluateMetric(DATA, { sheet: '없는시트', filter: [], agg: 'count', of: [] }).ok, false);
  assert.equal(evaluateMetric(DATA, { sheet: null, filter: [], agg: 'sum', of: [] }).ok, false);
  assert.equal(evaluateMetric(DATA, { sheet: null, filter: [], agg: 'ratio', of: [] }).ok, false);
});

test('분모 0 처리', () => {
  const r = evaluateMetric(DATA, {
    label: '', sheet: null,
    filter: [{ col: '자동화상태', op: 'eq', value: 'DEPRECATED' }],
    agg: 'ratio', of: [{ col: '결과', op: 'eq', value: 'PASS' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.denominator, 0);
  assert.match(r.display, /분모 0/);
});

test('다중 시트 합산 + 컬럼 있는 시트만 평가', () => {
  const multi = {
    sheets: [
      DATA.sheets[0],
      { name: '요약', header: ['항목', '값'], rows: [['총계', '81']] }, // 조건 컬럼 없음 → 제외
      { name: 'TC 추가', header: ['ID', '자동화상태', '결과'], rows: [['TC-9', 'IMPLEMENTED', 'PASS']] },
    ],
  };
  const r = evaluateMetric(multi, {
    label: '', sheet: null,
    filter: [{ col: '자동화상태', op: 'eq', value: 'IMPLEMENTED' }],
    agg: 'count', of: [],
  });
  assert.equal(r.numerator, 4);
  assert.equal(r.denominator, 6);
});
