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

// 헤더 행 자동 탐지 — 신형 TC 템플릿은 1행이 "{시트명}" 표지행이고 실제 헤더(TC ID 행)가
// 아래쪽(~9행)에 있어, 1행 고정 가정으로는 시트 전체가 통계·AI 컨텍스트에서 누락된다.
// load 시점에 정규화하므로 기존 저장 데이터도 재업로드 없이 정상화된다.
const HEADER_SIGNATURE_RE = /^(tc[ _-]?id|no\.?|id)$/i;
const HEADER_SCAN_DEPTH = 20;
const HEADER_MIN_CELLS = 3; // 데이터 셀 우연 일치 오탐 방지 — 헤더 행은 채워진 셀이 여러 개

function isHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  const nonEmpty = row.filter(c => String(c == null ? '' : c).trim()).length;
  return nonEmpty >= HEADER_MIN_CELLS &&
    row.some(c => HEADER_SIGNATURE_RE.test(String(c == null ? '' : c).trim()));
}

function normalizeSheet(sheet) {
  // 시트 중간에 반복되는 헤더 행(다단 표)은 데이터에서 제거 — 통계·축 분포 오염 방지
  const stripRepeats = rows => (rows || []).filter(r => !isHeaderRow(r));

  if (isHeaderRow(sheet.header)) return { ...sheet, rows: stripRepeats(sheet.rows) };
  const all = [sheet.header, ...(sheet.rows || [])];
  for (let i = 1; i < Math.min(all.length, HEADER_SCAN_DEPTH); i++) {
    if (isHeaderRow(all[i])) {
      return {
        ...sheet,
        header: all[i].map(h => String(h == null ? '' : h).trim()),
        rows: stripRepeats(all.slice(i + 1)),
      };
    }
  }
  return sheet;
}

function load(reportId) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath(reportId), 'utf-8'));
    if (payload && Array.isArray(payload.sheets)) {
      payload.sheets = payload.sheets.map(normalizeSheet);
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function remove(reportId) {
  try { fs.unlinkSync(filePath(reportId)); } catch (_) { /* 없으면 무시 */ }
}

module.exports = { save, load, remove, normalizeSheet, SHEETS_DIR };
