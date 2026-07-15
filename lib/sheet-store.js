// 시트 원본 데이터 저장소 — 리포트별 JSON 파일 (report-ai-qa)
// db.json 은 매 요청 전체 로드되므로, 대용량 시트 rows 는 별도 파일로 분리한다.
const fs = require('fs');
const path = require('path');

const SHEETS_DIR = path.join(__dirname, '..', 'data', 'sheets');

function filePath(reportId) {
  // reportId 는 서버가 발급한 uuid 지만, 방어적으로 경로 조작 차단
  return path.join(SHEETS_DIR, `${path.basename(String(reportId))}.json`);
}

// allData: { 시트명: rows[][] } (첫 행 = header)
function save(reportId, allData) {
  if (!fs.existsSync(SHEETS_DIR)) fs.mkdirSync(SHEETS_DIR, { recursive: true });
  const sheets = Object.entries(allData || {})
    .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
    .map(([name, rows]) => ({
      name,
      header: (rows[0] || []).map(h => String(h == null ? '' : h).trim()),
      rows: rows.slice(1).map(r => (r || []).map(c => String(c == null ? '' : c))),
    }));
  const payload = { savedAt: new Date().toISOString(), sheets };
  fs.writeFileSync(filePath(reportId), JSON.stringify(payload), 'utf-8');
  return payload;
}

function load(reportId) {
  try {
    return JSON.parse(fs.readFileSync(filePath(reportId), 'utf-8'));
  } catch (_) {
    return null;
  }
}

function remove(reportId) {
  try { fs.unlinkSync(filePath(reportId)); } catch (_) { /* 없으면 무시 */ }
}

module.exports = { save, load, remove, SHEETS_DIR };
