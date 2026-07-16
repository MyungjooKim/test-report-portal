// normalizeSheet — 헤더 행 자동 탐지 테스트
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSheet } = require('../lib/sheet-store');

test('1행이 유효 헤더면 그대로 유지', () => {
  const s = normalizeSheet({
    name: 'A',
    header: ['', 'TC ID', '카테고리', '결과'],
    rows: [['', 'TC-001', '로그인', 'Pass']],
  });
  assert.deepStrictEqual(s.header, ['', 'TC ID', '카테고리', '결과']);
  assert.strictEqual(s.rows.length, 1);
});

test('표지행 템플릿 — 아래쪽 TC ID 행을 헤더로 승격', () => {
  const s = normalizeSheet({
    name: 'B',
    header: ['', '{시트명}'],
    rows: [
      [],
      ['', ''],
      ['', 'TC ID', '카테고리', '스텝', '결과'],
      ['', 'TC-001', '로그인', '클릭', 'Pass'],
      ['', 'TC-002', '로그인', '입력', 'Fail'],
    ],
  });
  assert.deepStrictEqual(s.header.slice(1, 3), ['TC ID', '카테고리']);
  assert.strictEqual(s.rows.length, 2);
  assert.strictEqual(s.rows[0][1], 'TC-001');
});

test('시트 중간 반복 헤더 행은 데이터에서 제거', () => {
  const s = normalizeSheet({
    name: 'C',
    header: ['', 'TC ID', '카테고리', '결과'],
    rows: [
      ['', 'TC-001', '로그인', 'Pass'],
      ['', 'TC ID', '카테고리', '결과'], // 반복 헤더
      ['', 'TC-002', '로그인', 'Fail'],
    ],
  });
  assert.strictEqual(s.rows.length, 2);
  assert.ok(s.rows.every(r => r[1] !== 'TC ID'));
});

test('헤더 시그니처가 전혀 없으면 원본 유지 (목차·차트 시트)', () => {
  const s = normalizeSheet({
    name: 'D',
    header: ['항목', '설명'],
    rows: [['커버리지', '80%']],
  });
  assert.deepStrictEqual(s.header, ['항목', '설명']);
  assert.strictEqual(s.rows.length, 1);
});

test('데이터 셀 우연 일치는 헤더로 오인하지 않음 (채워진 셀 3개 미만)', () => {
  const s = normalizeSheet({
    name: 'E',
    header: ['', '{시트명}'],
    rows: [
      ['', 'ID'], // 셀 1개뿐 — 헤더 아님
      ['', 'TC ID', '카테고리', '결과'],
      ['', 'TC-001', 'x', 'Pass'],
    ],
  });
  assert.strictEqual(s.rows.length, 1);
  assert.strictEqual(s.rows[0][1], 'TC-001');
});
