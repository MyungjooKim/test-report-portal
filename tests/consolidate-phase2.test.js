// 취합 코어 Phase 2 확장 테스트 — N/A(D1)·envResults(D3)·환경축
const { test } = require('node:test');
const assert = require('node:assert');
const { consolidate } = require('../lib/consolidate');

const rec = (tcId, source, result, extra = {}) => ({ tcId, source, result, ...extra });

test('D1 — 매뉴얼 N/A + 자동화 Pass → 최종 Pass, 불일치 아님', () => {
  const { rows } = consolidate([
    rec('SC-X-001', 'manual', 'N/A'),
    rec('SC-X-001', 'automation', 'Pass'),
  ]);
  assert.equal(rows[0].final, 'Pass');
  assert.equal(rows[0].mismatch, false);
});

test('D1 — 전 소스 N/A → 최종 N/A, 모수(totalTc)에서 제외', () => {
  const { rows, stats } = consolidate([
    rec('SC-X-001', 'manual', 'N/A'),
    rec('SC-X-002', 'manual', 'Pass'),
    rec('SC-X-003', 'manual', 'Fail'),
    rec('SC-X-004', 'manual', 'N/T'),
  ]);
  const na = rows.find(r => r.tcId === 'SC-X-001');
  assert.equal(na.final, 'N/A');
  assert.equal(stats.byFinal['N/A'], 1);
  assert.equal(stats.totalTc, 3);          // 4행 - N/A 1행
  assert.equal(stats.executed, 2);         // Pass + Fail
  assert.equal(stats.passRate, 50);        // 1/2
});

test('D1 — N/A 와 N/T 혼재 시 N/T (범위 내 미수행이 남아 있음)', () => {
  const { rows } = consolidate([
    rec('SC-X-001', 'manual', 'N/A'),
    rec('SC-X-001', 'automation', 'N/T'),
  ]);
  assert.equal(rows[0].final, 'N/T');
});

test('불일치 — 매뉴얼 Pass vs 자동화 Fail → mismatch·보수적 Fail (기존 규칙 유지)', () => {
  const { rows, stats } = consolidate([
    rec('SC-X-001', 'manual', 'Pass'),
    rec('SC-X-001', 'automation', 'Fail'),
  ]);
  assert.equal(rows[0].mismatch, true);
  assert.equal(rows[0].final, 'Fail');
  assert.equal(stats.mismatch, 1);
});

test('D3 — envResults 가 pivot 셀에 보존되어 전달', () => {
  const { rows } = consolidate([
    rec('SC-X-001', 'manual', 'Pass', {
      envResults: [{ env: 'Win/MAC-Tester 1', result: 'Pass' }, { env: 'MAC-Tester 2', result: 'N/T' }],
    }),
  ]);
  assert.deepEqual(rows[0].sources.manual.envResults, [
    { env: 'Win/MAC-Tester 1', result: 'Pass' },
    { env: 'MAC-Tester 2', result: 'N/T' },
  ]);
});

test('환경축 — envResults 기반 집계, filterable:false, N/A 는 축 분포 제외', () => {
  const { axes } = consolidate([
    rec('SC-X-001', 'manual', 'Pass', { envResults: [{ env: 'Win', result: 'Pass' }, { env: 'MAC', result: 'Fail' }] }),
    rec('SC-X-002', 'manual', 'N/A', { envResults: [{ env: 'Win', result: 'N/A' }] }),
  ]);
  const env = axes.find(a => a.key === 'env');
  assert.ok(env);
  assert.equal(env.filterable, false);
  const win = env.values.find(v => v.value === 'Win');
  assert.equal(win.pass, 1);
  assert.equal(win.total, 1); // N/A 는 미집계
});

test('거래소 조인(D3) — 매뉴얼(거래소 없음)은 같은 TC 의 모든 거래소 행에 조인, 행별 불일치 판정', () => {
  const { rows } = consolidate([
    rec('SC-X-001', 'automation', 'Pass', { exchange: 'Binance' }),
    rec('SC-X-001', 'automation', 'Fail', { exchange: 'BingX' }),
    rec('SC-X-001', 'manual', 'Pass'),
  ]);
  assert.equal(rows.length, 2); // TC 단독 행이 따로 생기지 않음
  const bingx = rows.find(r => r.exchange === 'BingX');
  const binance = rows.find(r => r.exchange === 'Binance');
  assert.equal(bingx.sources.manual.result, 'Pass');
  assert.equal(bingx.mismatch, true);    // 매뉴얼 Pass vs 자동화 Fail
  assert.equal(binance.mismatch, false); // 둘 다 Pass
});

test('거래소 조인 — 자동화에 없는 매뉴얼 전용 TC 는 단독 행 생성', () => {
  const { rows } = consolidate([
    rec('SC-X-001', 'automation', 'Pass', { exchange: 'Binance' }),
    rec('SC-X-900', 'manual', 'Pass'),
  ]);
  const solo = rows.find(r => r.tcId === 'SC-X-900');
  assert.ok(solo);
  assert.equal(solo.exchange, null);
});

test('환경축 — 거래소 조인 복제에도 TC 당 1회만 집계', () => {
  const { axes } = consolidate([
    rec('SC-X-001', 'automation', 'Pass', { exchange: 'Binance' }),
    rec('SC-X-001', 'automation', 'Pass', { exchange: 'BingX' }),
    rec('SC-X-001', 'manual', 'Pass', { envResults: [{ env: 'Win', result: 'Pass' }] }),
  ]);
  const env = axes.find(a => a.key === 'env');
  assert.equal(env.values.find(v => v.value === 'Win').pass, 1); // 2행 복제돼도 1회
});

test('무회귀 — envResults 없는 자동화 전용 입력은 환경축 미생성', () => {
  const { axes } = consolidate([
    rec('SC-X-001', 'automation', 'Pass', { exchange: 'Binance' }),
  ]);
  assert.equal(axes.find(a => a.key === 'env'), undefined);
});
