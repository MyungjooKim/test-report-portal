// chunk-store — 청크 저장·재조립·잔여물 정리 테스트
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { saveChunk, completeUpload, cleanStale, CHUNK_TTL_MS } = require('../lib/chunk-store');

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-store-'));
}

test('청크 3개를 순서대로 이어붙여 원본과 동일하게 재조립', () => {
  const base = tmpBase();
  const parts = [Buffer.from('hello '), Buffer.from('chunked '), Buffer.from('world')];
  parts.forEach((buf, i) => saveChunk(base, 'upload-abc-123', i, buf));

  const dest = completeUpload(base, 'upload-abc-123', 3, 'out.zip');
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'hello chunked world');
  // 재조립 후 청크 디렉터리는 제거된다
  assert.ok(!fs.existsSync(path.join(base, '.chunks', 'upload-abc-123')));
});

test('누락 청크가 있으면 오류 + 미완성 산출물을 남기지 않음', () => {
  const base = tmpBase();
  saveChunk(base, 'upload-abc-123', 0, Buffer.from('a'));
  saveChunk(base, 'upload-abc-123', 2, Buffer.from('c')); // 1 누락

  assert.throws(() => completeUpload(base, 'upload-abc-123', 3, 'out.zip'), /누락/);
  assert.ok(!fs.existsSync(path.join(base, 'out.zip')));
});

test('경로 조작이 가능한 uploadId 는 거부', () => {
  const base = tmpBase();
  assert.throws(() => saveChunk(base, '../escape', 0, Buffer.from('x')), /uploadId/);
  assert.throws(() => completeUpload(base, 'a/../../b', 1, 'out.zip'), /uploadId/);
});

test('잘못된 chunkIndex·totalChunks 는 거부', () => {
  const base = tmpBase();
  assert.throws(() => saveChunk(base, 'upload-abc-123', -1, Buffer.from('x')), /chunkIndex/);
  assert.throws(() => saveChunk(base, 'upload-abc-123', 'x', Buffer.from('x')), /chunkIndex/);
  assert.throws(() => completeUpload(base, 'upload-abc-123', 0, 'out.zip'), /totalChunks/);
});

test('cleanStale — TTL 지난 미완성 업로드만 정리', () => {
  const base = tmpBase();
  saveChunk(base, 'old-upload-1', 0, Buffer.from('x'));
  saveChunk(base, 'new-upload-1', 0, Buffer.from('y'));

  // old 디렉터리의 mtime 을 TTL 이전으로 되돌린다
  const oldDir = path.join(base, '.chunks', 'old-upload-1');
  const past = new Date(Date.now() - CHUNK_TTL_MS - 60_000);
  fs.utimesSync(oldDir, past, past);

  const removed = cleanStale(base);
  assert.strictEqual(removed, 1);
  assert.ok(!fs.existsSync(oldDir));
  assert.ok(fs.existsSync(path.join(base, '.chunks', 'new-upload-1')));
});
