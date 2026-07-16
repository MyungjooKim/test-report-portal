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

// 2단 헤더의 서브 행 분리 — TC 템플릿은 헤더 행(기기: Win/MAC·MAC) 바로 아래에
// 서브 헤더 행(테스터/거래소: Tester 1·Bitget 등, TC ID 없음)이 온다.
// 결과 컬럼 라벨을 "Win/MAC-Tester 1" 처럼 조합할 수 있도록 subHeader 로 추출한다.
function extractSubHeader(header, rows) {
  const first = rows[0];
  if (!first || !Array.isArray(first)) return { subHeader: null, rows };
  const idCol = header.findIndex(h => HEADER_SIGNATURE_RE.test(String(h == null ? '' : h).trim()));
  const idVal = idCol >= 0 ? String(first[idCol] == null ? '' : first[idCol]).trim() : '';
  const nonEmpty = first.filter(c => String(c == null ? '' : c).trim()).length;
  if (idVal || nonEmpty === 0) return { subHeader: null, rows }; // TC 데이터 행이면 서브 헤더 아님
  return {
    subHeader: first.map(c => String(c == null ? '' : c).trim()),
    rows: rows.slice(1),
  };
}

function normalizeSheet(sheet) {
  // 시트 중간에 반복되는 헤더 행(다단 표)은 데이터에서 제거 — 통계·축 분포 오염 방지
  const stripRepeats = rows => (rows || []).filter(r => !isHeaderRow(r));

  if (isHeaderRow(sheet.header)) {
    const { subHeader, rows } = extractSubHeader(sheet.header, stripRepeats(sheet.rows));
    return { ...sheet, subHeader, rows };
  }
  const all = [sheet.header, ...(sheet.rows || [])];
  for (let i = 1; i < Math.min(all.length, HEADER_SCAN_DEPTH); i++) {
    if (isHeaderRow(all[i])) {
      let header = all[i].map(h => String(h == null ? '' : h).trim());

      // 상위 헤더 행(바로 위) — 템플릿에 따라 기기(Win/MAC 등)가 헤더 행 위에 병합되어 있다.
      // 빈 헤더 셀은 상위 행 값으로 보충(축 컬럼: 중요도·거래소 등)하고, 원본은 superHeader 로 보존
      const superRow = (all[i - 1] || []).map(h => String(h == null ? '' : h).trim());
      const hasSuper = superRow.some(c => c);
      if (hasSuper) {
        header = header.map((h, c) => h || superRow[c] || '');
      }

      const { subHeader, rows } = extractSubHeader(header, stripRepeats(all.slice(i + 1)));
      return { ...sheet, header, superHeader: hasSuper ? superRow : null, subHeader, rows };
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
