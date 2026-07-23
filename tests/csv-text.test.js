// decodeCsvBuffer — CSV 인코딩 감지(UTF-8/BOM/CP949) 테스트
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeCsvBuffer } = require('../lib/csv-text');

test('BOM 없는 UTF-8 한글', () => {
  const buf = Buffer.from('TC ID,결과\nSC-LOGIN-001,Pass\n', 'utf8');
  assert.match(decodeCsvBuffer(buf), /결과/);
});

test('UTF-8 BOM — BOM 제거 후 디코딩', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('TC ID,결과\n', 'utf8')]);
  const text = decodeCsvBuffer(buf);
  assert.ok(text.startsWith('TC ID'));
  assert.match(text, /결과/);
});

test('CP949(EUC-KR) 한글 — 결과(b0e1b0fa) 복원', () => {
  const buf = Buffer.concat([
    Buffer.from('TC ID,', 'ascii'),
    Buffer.from([0xb0, 0xe1, 0xb0, 0xfa]), // '결과' EUC-KR
    Buffer.from('\nSC-LOGIN-001,Pass\n', 'ascii'),
  ]);
  assert.match(decodeCsvBuffer(buf), /결과/);
});

test('ASCII 전용은 그대로', () => {
  const buf = Buffer.from('TC ID,Result\nSC-LOGIN-001,Pass\n', 'ascii');
  assert.strictEqual(decodeCsvBuffer(buf), 'TC ID,Result\nSC-LOGIN-001,Pass\n');
});
