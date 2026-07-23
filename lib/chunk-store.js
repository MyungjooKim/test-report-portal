// 청크 업로드 스토어 — Cloudflare 프록시의 요청 본문 100MB 제한을 우회하기 위해
// 큰 파일을 조각(청크)으로 받아 <baseDir>/.chunks/<uploadId>/ 에 모으고,
// complete 시 순서대로 이어붙여 하나의 파일로 재조립한다.
const fs = require('fs');
const path = require('path');

const CHUNK_TTL_MS = 60 * 60 * 1000; // 미완성 업로드 잔여물 보관 1시간
const MAX_CHUNKS = 64; // 64 × 64MB ≈ 4GB 상한 안전장치

function chunkDir(baseDir, uploadId) {
  return path.join(baseDir, '.chunks', uploadId);
}

function assertUploadId(uploadId) {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(String(uploadId || ''))) throw new Error('잘못된 uploadId 입니다.');
}

function saveChunk(baseDir, uploadId, chunkIndex, buf) {
  assertUploadId(uploadId);
  const idx = Number(chunkIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_CHUNKS) throw new Error('잘못된 chunkIndex 입니다.');
  const dir = chunkDir(baseDir, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, String(idx)), buf);
}

// 모든 청크를 순서대로 이어붙여 baseDir/destName 으로 재조립. 누락 청크가 있으면 오류.
// destName 은 호출부(서버)가 생성한 uuid 파일명만 받는다 — 경로 조작 입력 금지.
function completeUpload(baseDir, uploadId, totalChunks, destName) {
  assertUploadId(uploadId);
  const total = Number(totalChunks);
  if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) throw new Error('잘못된 totalChunks 입니다.');
  const dir = chunkDir(baseDir, uploadId);
  const destPath = path.join(baseDir, destName);
  let out = fs.openSync(destPath, 'w');
  try {
    for (let i = 0; i < total; i++) {
      const p = path.join(dir, String(i));
      if (!fs.existsSync(p)) throw new Error(`청크 ${i + 1}/${total} 가 누락되었습니다. 다시 업로드해 주세요.`);
      fs.writeSync(out, fs.readFileSync(p)); // 청크 단위(≤64MB)로만 메모리에 올린다
    }
    fs.closeSync(out);
    out = null;
  } catch (e) {
    if (out !== null) fs.closeSync(out);
    try { fs.unlinkSync(destPath); } catch (_) { /* 미완성 산출물 제거 */ }
    throw e;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return destPath;
}

// TTL 을 넘긴 미완성 청크 디렉터리 정리 (업로드 중단·이탈 잔여물)
function cleanStale(baseDir, now = Date.now()) {
  const root = path.join(baseDir, '.chunks');
  if (!fs.existsSync(root)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try {
      if (now - fs.statSync(dir).mtimeMs > CHUNK_TTL_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    } catch (_) { /* 동시 정리 경합 무시 */ }
  }
  return removed;
}

module.exports = { saveChunk, completeUpload, cleanStale, CHUNK_TTL_MS, MAX_CHUNKS };
