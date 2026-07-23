// 취합 — test-run 권위 최종 규칙 (수행 보드 3-소스 발행 대응)
const test = require('node:test');
const assert = require('node:assert');
const { consolidate } = require('../lib/consolidate');

function rec(source, result, extra = {}) {
  return { tcId: 'SC-A-001', source, result, exchange: 'Binance', untagged: false, ...extra };
}

test('test-run 소스가 있으면 최종은 그 값 — 커버리지 인지 파생 보존', () => {
  // 부분 커버리지 자동 Pass 단독: 보드 최종 = N/T. D 규칙이면 Pass 가 됐을 상황.
  const { rows } = consolidate([rec('automation', 'Pass'), rec('test-run', 'N/T')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].final, 'N/T');
  assert.equal(rows[0].mismatch, false); // 권위값이 미결정(N/T)일 땐 불일치 아님 (부분 커버리지 정상 상태)
});

test('test-run 권위값과 다른 결정 소스는 mismatch 표시 (최종은 권위 유지)', () => {
  // 보드에서 수동 확정으로 Pass 를 Fail 로 뒤집은 경우 등
  const { rows } = consolidate([rec('manual', 'Pass'), rec('test-run', 'Fail')]);
  assert.equal(rows[0].final, 'Fail');
  assert.equal(rows[0].mismatch, true);
});

test('test-run 과 다른 소스가 일치하면 mismatch 없음', () => {
  const { rows } = consolidate([rec('manual', 'Fail'), rec('automation', 'Fail'), rec('test-run', 'Fail')]);
  assert.equal(rows[0].final, 'Fail');
  assert.equal(rows[0].mismatch, false);
});

test('test-run 소스가 없으면 기존 D 규칙 그대로 (무회귀)', () => {
  const { rows } = consolidate([rec('manual', 'Pass'), rec('automation', 'Fail')]);
  assert.equal(rows[0].final, 'Fail'); // 불일치 → 보수적 Fail
  assert.equal(rows[0].mismatch, true);
});

test('3-소스 발행 형태 — 소스 컬럼 3개가 pivot 에 나란히 표시', () => {
  const { rows, sources } = consolidate([
    rec('automation', 'Pass'), rec('manual', 'Fail', { reasonNote: '버튼 미노출' }), rec('test-run', 'Fail'),
  ]);
  assert.deepEqual(sources.sort(), ['automation', 'manual', 'test-run']);
  assert.equal(rows[0].sources['automation'].result, 'Pass');
  assert.equal(rows[0].sources['manual'].result, 'Fail');
  assert.equal(rows[0].sources['manual'].reason, '버튼 미노출');
  assert.equal(rows[0].final, 'Fail');
});
