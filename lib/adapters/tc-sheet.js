// TC 양식 어댑터 (test-run R1, docs/01-plan/features/test-run.plan.md §TC 양식)
// ─────────────────────────────────────────────────────────────────────────
// 테스트 수행 보드 생성용 — TC 목록 시트(XLSX/CSV/GSheet)를 보드 TC 행으로 변환한다.
// 결과 시트가 아니므로 결과 컬럼은 요구하지 않는다(매뉴얼 어댑터와의 차이).
// 헤더 행 탐지·다단 헤더는 sheet-store.normalizeSheet, TC ID 컬럼 탐지·중요도
// 정규화·플랫폼 프리픽스는 manual-sheet 어댑터를 재사용한다.
//
// 실물 확인 컬럼 (SCM 모바일 TC 시트):
//   TC ID | 대분류 | 중분류 | 소분류 | 사전조건 | 테스트 스텝 | 기대결과 | 중요도
//   | 대상 거래소 | smoke | 화면코드 | Program IDs | Coverage % | Coverage 메모 | 자동화 상태

const { normalizeSheet } = require('../sheet-store');
const { findTcIdCol, normalizePriority, platformOf, TC_ID_RE } = require('./manual-sheet');

// 컬럼 동의어 — P5 표준 헤더(사전조건/스텝/기대결과/중요도)는 manual-sheet 와 동일 계열
const COLUMN_RES = {
  category1: /^(대분류|category\s*1?)$/i,
  category2: /^(중분류|category\s*2)$/i,
  title: /^(소분류|항목|케이스명|title|제목|시나리오)$/i,
  precondition: /^(사전\s*조건|precondition)$/i,
  steps: /^(테스트\s*스텝|테스트\s*단계|수행\s*절차|steps?)$/i,
  expected: /^(기대\s*결과|예상\s*결과|expected(\s*result)?)$/i,
  priority: /^(중요도|우선\s?순위|priority)$/i,
  targetExchanges: /^(대상\s*거래소|거래소|exchanges?)$/i,
  smoke: /^smoke$/i,
  screenCode: /^(화면\s*코드|screen\s*code)$/i,
  programIds: /^program\s*ids?$/i,
  coveragePct: /^coverage\s*%?$/i,
  coverageNote: /^coverage\s*(메모|note)$/i,
  automation: /^(자동화\s*상태|automation(\s*status)?)$/i,
};

function findCols(header) {
  const cols = {};
  for (const [key, re] of Object.entries(COLUMN_RES)) {
    cols[key] = header.findIndex(h => re.test(String(h == null ? '' : h).trim()));
  }
  return cols;
}

function cellStr(row, c) {
  if (c < 0) return '';
  return String((row && row[c]) == null ? '' : row[c]).trim();
}

// "80%", "80", "0.8" → 0~100 정수. 소수(≤1)는 비율로 간주. 파싱 불가는 null.
function parseCoverage(v) {
  const s = String(v == null ? '' : v).trim().replace(/%$/, '');
  if (!s) return null;
  let n = Number(s);
  if (!isFinite(n)) return null;
  if (n > 0 && n <= 1 && /\./.test(s)) n = n * 100;
  n = Math.round(n);
  return Math.min(100, Math.max(0, n));
}

function parseSmoke(v) {
  return /^(true|y|yes|o|1|✓|✔)$/i.test(String(v == null ? '' : v).trim());
}

// "Binance, BingX / Bybit" → ['Binance','BingX','Bybit']
function parseExchanges(v) {
  return String(v == null ? '' : v)
    .split(/[,/;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 반환: { adopted, reason?, tcIdCol, cols, rowCount }
function analyzeSheet(sheet) {
  const header = sheet.header || [];
  const rows = sheet.rows || [];
  if (!rows.length) return { adopted: false, reason: '데이터 없음' };

  const tcIdCol = findTcIdCol(header, rows);
  if (tcIdCol < 0) return { adopted: false, reason: 'TC ID 컬럼 없음' };

  const validRows = rows.filter(r => TC_ID_RE.test(cellStr(r, tcIdCol)));
  if (validRows.length < 1) return { adopted: false, reason: 'TC ID 패턴 매칭 행 없음' };

  return { adopted: true, tcIdCol, cols: findCols(header), rowCount: validRows.length };
}

// raw allData({시트명: rows[][]}) 또는 sheet-store 포맷 → normalizeSheet 적용 (manual-sheet 와 동일 문법)
function toSheets(input) {
  let sheets;
  if (input && Array.isArray(input.sheets)) {
    sheets = input.sheets;
  } else if (input && typeof input === 'object') {
    sheets = Object.entries(input)
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .map(([name, rows]) => ({
        name,
        header: (rows[0] || []).map(h => String(h == null ? '' : h).trim()),
        rows: rows.slice(1).map(r => (r || []).map(c => String(c == null ? '' : c))),
      }));
  } else {
    sheets = [];
  }
  return sheets.map(normalizeSheet);
}

function supports(input) {
  try {
    return toSheets(input).some(s => analyzeSheet(s).adopted);
  } catch (_) {
    return false;
  }
}

// parse(input) → { tcs: [...], detected }
// tcId 중복은 첫 행 우선(시트 간 중복 포함), 시트 순서·행 순서 보존.
function parse(input) {
  const sheets = toSheets(input);
  const detectedSheets = [];
  const tcs = [];
  const seen = new Set();

  for (const sheet of sheets) {
    const a = analyzeSheet(sheet);
    if (!a.adopted) {
      detectedSheets.push({ name: sheet.name, adopted: false, reason: a.reason, rowCount: 0 });
      continue;
    }
    detectedSheets.push({ name: sheet.name, adopted: true, rowCount: a.rowCount });

    // 대/중분류는 병합 셀로 아래 행이 비는 경우가 많아 직전 값을 이어받는다
    let lastCat1 = '', lastCat2 = '';
    for (const row of sheet.rows) {
      const tcId = cellStr(row, a.tcIdCol);
      if (!TC_ID_RE.test(tcId)) continue;
      const c = a.cols;
      const cat1 = cellStr(row, c.category1) || lastCat1;
      const cat2 = cellStr(row, c.category2) || lastCat2;
      lastCat1 = cat1; lastCat2 = cat2;
      if (seen.has(tcId)) continue;
      seen.add(tcId);

      tcs.push({
        tcId,
        title: cellStr(row, c.title) || null,
        category1: cat1 || null,
        category2: cat2 || null,
        precondition: cellStr(row, c.precondition) || null,
        steps: cellStr(row, c.steps) || null,
        expected: cellStr(row, c.expected) || null,
        priority: normalizePriority(cellStr(row, c.priority)),
        targetExchanges: c.targetExchanges >= 0 ? parseExchanges(row[c.targetExchanges]) : [],
        smoke: c.smoke >= 0 ? parseSmoke(row[c.smoke]) : false,
        screenCode: cellStr(row, c.screenCode) || null,
        programIds: cellStr(row, c.programIds) || null,
        coveragePct: c.coveragePct >= 0 ? parseCoverage(row[c.coveragePct]) : null,
        coverageNote: cellStr(row, c.coverageNote) || null,
        automation: cellStr(row, c.automation) || null,
        platform: platformOf(tcId),
        sheet: sheet.name,
      });
    }
  }

  const platforms = [...new Set(tcs.map(t => t.platform).filter(Boolean))];
  return {
    tcs,
    detected: { format: 'tc-sheet', sheets: detectedSheets, tcCount: tcs.length, platforms },
  };
}

module.exports = { supports, parse, analyzeSheet, parseCoverage, parseSmoke, parseExchanges };
