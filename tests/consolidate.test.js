// consolidate 단위 테스트 — pivot 병합, 최종 상태, 불일치, worst-wins, 커버리지
const { test } = require('node:test');
const assert = require('node:assert');
const { consolidate, worst } = require('../lib/consolidate');

function rec(o) {
  return { source: 'automation', result: 'Pass', exchange: null, tcId: 'SC-A-001',
           reasonNote: null, flaky: false, attachments: [], untagged: false, ...o };
}

test('worst — 심각도 우선(Fail > Pass > N/T)', () => {
  assert.equal(worst(['Pass', 'Fail', 'N/T']), 'Fail');
  assert.equal(worst(['Pass', 'N/T']), 'Pass');
  assert.equal(worst(['N/T']), 'N/T');
  assert.equal(worst([]), null);
});

test('단일 소스 — 최종 = 그 값, mismatch 없음', () => {
  const { rows, stats } = consolidate([
    rec({ tcId: 'SC-A-001', result: 'Pass' }),
    rec({ tcId: 'SC-A-002', result: 'Fail' }),
  ]);
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map(r => [r.tcId, r]));
  assert.equal(byId['SC-A-001'].final, 'Pass');
  assert.equal(byId['SC-A-002'].final, 'Fail');
  assert.equal(stats.mismatch, 0);
  assert.equal(stats.coverage.automation, 100);
});

test('같은 TC 여러 결과 — worst-wins (Fail)', () => {
  const { rows } = consolidate([
    rec({ tcId: 'SC-A-001', result: 'Pass' }),
    rec({ tcId: 'SC-A-001', result: 'Fail' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].final, 'Fail');
});

test('크로스 소스 불일치 — manual Pass / automation Fail → mismatch, 최종 Fail', () => {
  const { rows, stats } = consolidate([
    rec({ tcId: 'SC-A-001', source: 'manual', result: 'Pass' }),
    rec({ tcId: 'SC-A-001', source: 'automation', result: 'Fail' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mismatch, true);
  assert.equal(rows[0].final, 'Fail');
  assert.equal(rows[0].sources.manual.result, 'Pass');
  assert.equal(rows[0].sources.automation.result, 'Fail');
  assert.equal(stats.mismatch, 1);
});

test('크로스 소스 일치 — 둘 다 Pass → 최종 Pass, mismatch 없음', () => {
  const { rows, stats } = consolidate([
    rec({ tcId: 'SC-A-001', source: 'manual', result: 'Pass' }),
    rec({ tcId: 'SC-A-001', source: 'automation', result: 'Pass' }),
  ]);
  assert.equal(rows[0].final, 'Pass');
  assert.equal(rows[0].mismatch, false);
  assert.equal(stats.mismatch, 0);
});

test('거래소 축 분리 — 같은 TC, 다른 거래소 → 별도 행', () => {
  const { rows } = consolidate([
    rec({ tcId: 'SC-A-001', exchange: 'Binance', result: 'Pass' }),
    rec({ tcId: 'SC-A-001', exchange: 'BingX', result: 'Fail' }),
  ]);
  assert.equal(rows.length, 2);
  const bg = rows.find(r => r.exchange === 'Binance');
  const bx = rows.find(r => r.exchange === 'BingX');
  assert.equal(bg.final, 'Pass');
  assert.equal(bx.final, 'Fail');
});

test('N/T만 있는 TC — 최종 N/T, executed/passRate 제외', () => {
  const { rows, stats } = consolidate([
    rec({ tcId: 'SC-A-001', result: 'N/T' }),
    rec({ tcId: 'SC-A-002', result: 'Pass' }),
  ]);
  assert.equal(rows.find(r => r.tcId === 'SC-A-001').final, 'N/T');
  assert.equal(stats.executed, 1);
  assert.equal(stats.passRate, 100);
});

test('untagged 레코드 — 행에서 제외, 별도 카운트', () => {
  const { rows, stats, untagged } = consolidate([
    rec({ tcId: 'SC-A-001', result: 'Pass' }),
    rec({ tcId: null, untagged: true, title: 'AllTest' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(stats.untagged, 1);
  assert.equal(untagged.count, 1);
  assert.equal(untagged.items[0].title, 'AllTest');
});

// ── 축별 분포 (스펙 §9.3-②) ─────────────────────────────────────────────

test('axes — 거래소별 최종 상태 분포', () => {
  const { axes } = consolidate([
    rec({ tcId: 'SC-A-001', exchange: 'Binance', result: 'Pass' }),
    rec({ tcId: 'SC-A-002', exchange: 'Binance', result: 'Fail' }),
    rec({ tcId: 'SC-A-001', exchange: 'BingX', result: 'N/T' }),
  ]);
  const exch = axes.find(a => a.key === 'exchange');
  const bg = exch.values.find(v => v.value === 'Binance');
  const bx = exch.values.find(v => v.value === 'BingX');
  assert.deepEqual({ pass: bg.pass, fail: bg.fail, nt: bg.nt, total: bg.total }, { pass: 1, fail: 1, nt: 0, total: 2 });
  assert.deepEqual({ pass: bx.pass, fail: bx.fail, nt: bx.nt, total: bx.total }, { pass: 0, fail: 0, nt: 1, total: 1 });
});

test('axes — suite 축은 record.suite에서, 없으면 축 생략', () => {
  const withSuite = consolidate([
    rec({ tcId: 'SC-A-001', suite: 'trade-order', result: 'Pass' }),
    rec({ tcId: 'SC-A-002', suite: 'trade-order', result: 'Fail' }),
  ]);
  const suiteAx = withSuite.axes.find(a => a.key === 'suite');
  assert.equal(suiteAx.values[0].value, 'trade-order');
  assert.equal(suiteAx.values[0].total, 2);
  assert.equal(withSuite.rows[0].suite, 'trade-order'); // pivot 행에도 suite 유지 (필터용)

  const noSuite = consolidate([rec({ tcId: 'SC-A-001', result: 'Pass' })]);
  assert.equal(noSuite.axes.find(a => a.key === 'suite'), undefined);
  assert.equal(noSuite.axes.find(a => a.key === 'exchange'), undefined);
});

test('axes — source 축의 na = 해당 소스 결과 없는 행(미커버)', () => {
  const { axes } = consolidate([
    rec({ tcId: 'SC-A-001', source: 'manual', result: 'Pass' }),
    rec({ tcId: 'SC-A-001', source: 'automation', result: 'Pass' }),
    rec({ tcId: 'SC-A-002', source: 'manual', result: 'Fail' }), // automation 미커버
  ]);
  const srcAx = axes.find(a => a.key === 'source');
  const auto = srcAx.values.find(v => v.value === 'automation');
  const man = srcAx.values.find(v => v.value === 'manual');
  assert.deepEqual({ pass: auto.pass, na: auto.na, total: auto.total }, { pass: 1, na: 1, total: 1 });
  assert.deepEqual({ pass: man.pass, fail: man.fail, na: man.na }, { pass: 1, fail: 1, na: 0 });
});

// ── Fail 사유 패턴 그룹핑 (스펙 §9.3-③) ─────────────────────────────────

test('failReasons — expect/TimeoutError 패턴별 그룹, Fail만 집계', () => {
  const { failReasons } = consolidate([
    rec({ tcId: 'SC-A-001', result: 'Fail', reasonNote: 'Error: expect(locator).toBeVisible() failed' }),
    rec({ tcId: 'SC-A-002', result: 'Fail', reasonNote: 'Error: expect(locator).toBeVisible() failed\n\nLocator: #x' }),
    rec({ tcId: 'SC-A-003', result: 'Fail', reasonNote: 'TimeoutError: browserContext.waitForEvent: Timeout 5000ms exceeded while waiting for event "page"' }),
    rec({ tcId: 'SC-A-004', result: 'Pass', reasonNote: 'Error: expect(locator).toBeVisible() failed' }), // Pass는 제외
  ]);
  assert.equal(failReasons.length, 2);
  assert.equal(failReasons[0].pattern, 'expect(…).toBeVisible() failed');
  assert.equal(failReasons[0].count, 2);
  assert.deepEqual(failReasons[0].keys, ['SC-A-001 ', 'SC-A-002 ']);
  assert.equal(failReasons[1].pattern, 'TimeoutError: browserContext.waitForEvent');
  assert.equal(failReasons[1].count, 1);
});
