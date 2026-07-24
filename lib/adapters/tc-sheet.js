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

// 실제 테스트와 무관한 시트명(목차·표지·변경이력·범례 등) — 채택에서 배제한다.
// TC ID 형식 셀이 우연히 섞여 있어도 이 이름이면 테스트 대상 시트가 아니다.
const NON_TEST_SHEET_RE = /(목\s*차|차\s*례|table\s*of\s*contents|toc|표\s*지|커\s*버|cover|변\s*경\s*이\s*력|개\s*정\s*이\s*력|수\s*정\s*이\s*력|revision|change\s*log|changelog|history|이\s*력|요\s*약|summary|개\s*요|overview|index|색\s*인|가\s*이\s*드|guide|안\s*내|참\s*고|범\s*례|legend|readme|시\s*트\s*설\s*명)/i;

function isNonTestSheetName(name) {
  return NON_TEST_SHEET_RE.test(String(name == null ? '' : name).trim());
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
// 채택 기준(사용자 확정): TC ID 형식 셀이 있어도 아래를 모두 통과해야 테스트 시트로 인정.
//   ① 시트명이 목차·표지 등 비테스트 패턴이 아닐 것
//   ③ 실제 케이스 상세(스텝 또는 기대결과)가 채워진 TC 행이 1개 이상 있을 것
//      — TC 개수는 유동적이라 개수 임계는 두지 않는다(작은 시트도 통과).
function analyzeSheet(sheet) {
  const header = sheet.header || [];
  const rows = sheet.rows || [];
  if (!rows.length) return { adopted: false, reason: '데이터 없음' };

  // ① 시트명 배제 (목차·차례·표지·변경이력·범례 등)
  if (isNonTestSheetName(sheet.name)) {
    return { adopted: false, reason: '비테스트 시트명(목차·표지 등)' };
  }

  const tcIdCol = findTcIdCol(header, rows);
  if (tcIdCol < 0) return { adopted: false, reason: 'TC ID 컬럼 없음' };

  const validRows = rows.filter(r => TC_ID_RE.test(cellStr(r, tcIdCol)));
  if (validRows.length < 1) return { adopted: false, reason: 'TC ID 패턴 매칭 행 없음' };

  // ③ 상세 컬럼(스텝·기대결과) 채움 검증 — 목차/표지는 TC ID 만 나열되어 여기서 배제된다.
  const cols = findCols(header);
  const hasDetailCol = cols.steps >= 0 || cols.expected >= 0;
  const hasDetailRow = hasDetailCol && validRows.some(r =>
    cellStr(r, cols.steps) !== '' || cellStr(r, cols.expected) !== ''
  );
  if (!hasDetailRow) {
    return { adopted: false, reason: 'TC 상세(스텝·기대결과) 없음' };
  }

  return { adopted: true, tcIdCol, cols, rowCount: validRows.length };
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

module.exports = { supports, parse, analyzeSheet, isNonTestSheetName, parseCoverage, parseSmoke, parseExchanges };
