// computeDetailStats — 특징 축 감지·분포 테스트
const { test } = require('node:test');
const assert = require('node:assert');
const { computeDetailStats } = require('../lib/detail-stats');

function sheet(header, rows) {
  return { sheets: [{ name: 'S', header, rows }] };
}

const HEADER = ['', 'TC ID', '거래소', '우선순위', '스텝', '결과'];
const ROWS = [
  ['', 'TC-1', 'HL', 'High', '...', 'Pass'],
  ['', 'TC-2', 'HL, GT', 'High', '...', 'Fail'],
  ['', 'TC-3', 'GT', 'Medium', '...', 'N/T'],
  ['', 'TC-4', 'BB', 'Low', '...', 'N/A'],
  ['', 'TC-5', 'HL', 'Medium', '...', 'Pass'],
];

test('축 감지: 카디널리티 낮은 범주형 컬럼(거래소·우선순위)만 축으로 채택', () => {
  const d = computeDetailStats(sheet(HEADER, ROWS), { minTotal: 1, minNonEmpty: 2 });
  const names = d.axes.map(a => a.name);
  assert.ok(names.includes('거래소'));
  assert.ok(names.includes('우선순위'));
  assert.ok(!names.includes('스텝')); // 서술 컬럼 제외 (고유값 폭발/길이)
  assert.ok(!names.includes('TC ID'));
});

test('다중값 셀(HL, GT) 분해 — 각 거래소에 결과 귀속', () => {
  const d = computeDetailStats(sheet(HEADER, ROWS), { minTotal: 1, minNonEmpty: 2 });
  const ex = d.axes.find(a => a.name === '거래소');
  const hl = ex.values.find(v => v.value === 'HL');
  const gt = ex.values.find(v => v.value === 'GT');
  assert.strictEqual(hl.pass, 2);
  assert.strictEqual(hl.fail, 1);
  assert.strictEqual(gt.fail, 1);
  assert.strictEqual(gt.nt, 1);
});

test('N/A 는 total 모수에서 제외 (기존 정책 유지)', () => {
  const d = computeDetailStats(sheet(HEADER, ROWS), { minTotal: 1, minNonEmpty: 2 });
  const ex = d.axes.find(a => a.name === '거래소');
  const bb = ex.values.find(v => v.value === 'BB');
  assert.strictEqual(bb.na, 1);
  assert.strictEqual(bb.total, 0);
});

test('결과 컬럼 헤더 = 기기 축(devices), N/T 값은 / 로 분해되지 않음', () => {
  const d = computeDetailStats(sheet(
    ['', 'TC ID', 'Win/MAC', 'MAC'],
    [
      ['', 'TC-1', 'Pass', 'Fail'],
      ['', 'TC-2', 'N/T', 'Pass'],
      ['', 'TC-3', 'N/T', 'N/T'],
    ]
  ), { minTotal: 1 });
  const win = d.devices.find(x => x.name === 'Win/MAC');
  const mac = d.devices.find(x => x.name === 'MAC');
  assert.deepStrictEqual({ p: win.pass, n: win.nt }, { p: 1, n: 2 });
  assert.deepStrictEqual({ p: mac.pass, f: mac.fail }, { p: 1, f: 1 });
});

test('발동 기준: minTotal 미달이면 available=false', () => {
  const d = computeDetailStats(sheet(HEADER, ROWS), { minTotal: 100, minNonEmpty: 2 });
  assert.strictEqual(d.available, false);
});

test('체크마크 정규화 (∨/V/Y → ✓)', () => {
  const d = computeDetailStats(sheet(
    ['', 'TC ID', 'Smoke', '결과'],
    [
      ['', 'TC-1', '∨', 'Pass'],
      ['', 'TC-2', 'V', 'Pass'],
      ['', 'TC-3', 'Y', 'Fail'],
      ['', 'TC-4', '', 'Pass'],
    ]
  ), { minTotal: 1, minNonEmpty: 2 });
  const smoke = d.axes.find(a => a.name === 'Smoke');
  assert.ok(smoke, 'Smoke 축 감지');
  assert.strictEqual(smoke.values.length, 1);
  assert.strictEqual(smoke.values[0].value, '✓');
  assert.strictEqual(smoke.values[0].total, 3);
});
