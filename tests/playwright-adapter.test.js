// Playwright 어댑터 단위 테스트 — TC ID 파싱(단일/다중/범위), outcome 매핑, 폴더명 파싱
const { test } = require('node:test');
const assert = require('node:assert');
const { parseTcIds, mapOutcome, parseFolderName } = require('../lib/adapters/playwright');

test('parseTcIds — 단일 TC', () => {
  assert.deepEqual(parseTcIds('[SC-TRD-ORDR-034] 수량 0 입력'), ['SC-TRD-ORDR-034']);
  assert.deepEqual(parseTcIds('[SC-COMM-001] 공통'), ['SC-COMM-001']);
  assert.deepEqual(parseTcIds('[SC-EXCN-BG-045] Select Exchange 필터'), ['SC-EXCN-BG-045']);
});

test('parseTcIds — 파이프(|) 다중 TC', () => {
  assert.deepEqual(
    parseTcIds('[SC-TRD-ORDR-036 | SC-TRD-ORDR-084] 최소 주문 수량 미만'),
    ['SC-TRD-ORDR-036', 'SC-TRD-ORDR-084']
  );
  assert.deepEqual(
    parseTcIds('[SC-EXCN-BG-011 | SC-EXCN-BG-012] PortX 연결 팝업'),
    ['SC-EXCN-BG-011', 'SC-EXCN-BG-012']
  );
});

test('parseTcIds — 물결(~) 범위 전개', () => {
  assert.deepEqual(
    parseTcIds('[SC-TRD-ORHT-041 ~ SC-TRD-ORHT-052] Close Order Market'),
    ['SC-TRD-ORHT-041','SC-TRD-ORHT-042','SC-TRD-ORHT-043','SC-TRD-ORHT-044',
     'SC-TRD-ORHT-045','SC-TRD-ORHT-046','SC-TRD-ORHT-047','SC-TRD-ORHT-048',
     'SC-TRD-ORHT-049','SC-TRD-ORHT-050','SC-TRD-ORHT-051','SC-TRD-ORHT-052']
  );
});

test('parseTcIds — 범위 자릿수(zero-pad) 유지', () => {
  assert.deepEqual(parseTcIds('[SC-A-008 ~ SC-A-010]'), ['SC-A-008','SC-A-009','SC-A-010']);
});

test('parseTcIds — TC ID 없음(untagged)', () => {
  assert.deepEqual(parseTcIds('AllTest'), []);
  assert.deepEqual(parseTcIds('global.setup.ts'), []);
  assert.deepEqual(parseTcIds(''), []);
  assert.deepEqual(parseTcIds(null), []);
});

test('parseTcIds — 중복 제거', () => {
  assert.deepEqual(parseTcIds('[SC-X-001] a [SC-X-001] b'), ['SC-X-001']);
});

test('mapOutcome — Playwright outcome → 표준 결과값', () => {
  assert.equal(mapOutcome('expected'), 'Pass');
  assert.equal(mapOutcome('unexpected'), 'Fail');
  assert.equal(mapOutcome('skipped'), 'N/T');
  assert.equal(mapOutcome('flaky'), 'Pass');
  assert.equal(mapOutcome('weird'), 'N/T');
});

test('parseFolderName — 거래소 접두사 추출', () => {
  assert.deepEqual(parseFolderName('[Binance] trade-order'), { exchange: 'Binance', suite: 'trade-order' });
  assert.deepEqual(parseFolderName('[BingX] trade-tpsl'), { exchange: 'BingX', suite: 'trade-tpsl' });
  assert.deepEqual(parseFolderName('[Binance] setting.login'), { exchange: 'Binance', suite: 'setting.login' });
  assert.deepEqual(parseFolderName('misc-folder'), { exchange: null, suite: 'misc-folder' });
});
