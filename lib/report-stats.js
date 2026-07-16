// 리포트 통계 계산기 — 시트 원본 rows(sheet-store 포맷) 기반. (대시보드 계산식 전면 개편, 2026-07-15)
//
// 기존 HTML 휴리스틱 파싱의 문제를 해결한다:
//  1) 결과 컬럼 헤더 완전일치 요구 → "테스트 통과" 같은 실사용 헤더 미인식
//  2) 컬럼 미인식 시 skip 만 카운트 제외되는 비대칭 → N/T 가 0 으로 표시
//  3) N/T(미수행)와 N/A(해당 없음) 미구분
//
// 정책 (2026-07-15 사용자 확정):
//  - N/A 는 테스트 대상이 아니므로 Total·실행률 모수에서 제외, 별도 카운트(na)로 반환
//  - Total = pass + fail + nt / 실행률 = (pass+fail)/Total / Pass Rate = pass/(pass+fail)
//  - TC ID 컬럼이 있으면 값이 있는 행만 통계 대상 (빈 행·소계 행 오염 방지)
//  - 결과 컬럼은 헤더 별칭(부분일치) 후보를 값 프로파일로 검증 — 후보가 없으면 전 컬럼 프로파일 스캔

const RESULT_HEADER_RE = /(결과|통과|판정|result|status)/;
const RESULT_HEADER_EXCLUDE_RE = /(기대|예상|expected)/;
const RESULT_HEADER_EXACT = new Set(['android', 'ios', 'p/f', 'pf', 'pass/fail', 'mobile', 'web', 'mac', 'win', 'win/mac']);

// 결과 값 분류: 'pass' | 'fail' | 'nt'(미수행) | 'na'(해당 없음) | null(분류 불가)
function classifyResult(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(pass|passed|p|통과|ok)$/.test(s)) return 'pass';
  if (/^(fail|failed|f|실패|ng)$/.test(s)) return 'fail';
  if (/^(n\/t|nt|not tested|미수행|skip|skipped|보류|-)$/.test(s)) return 'nt';
  if (/^(n\/a|na|해당\s?없음|제외)$/.test(s)) return 'na';
  return null;
}

// 값 프로파일 검증: 비어있지 않은 값의 60% 이상이 결과 값으로 분류 가능해야 결과 컬럼.
// minNonEmpty — 헤더 별칭으로 잡힌 후보는 1(헤더 신호 신뢰, 소형 시트 대응),
//               전 컬럼 스캔은 3(우연 일치 오탐 방지)
function isResultColumnByProfile(rows, colIdx, minNonEmpty) {
  let nonEmpty = 0;
  let classified = 0;
  for (const row of rows) {
    const v = String((row && row[colIdx]) == null ? '' : row[colIdx]).trim();
    if (!v) continue;
    nonEmpty++;
    if (classifyResult(v)) classified++;
  }
  return nonEmpty >= minNonEmpty && classified / nonEmpty >= 0.6;
}

function detectResultColumns(header, rows) {
  const candidates = [];
  header.forEach((h, i) => {
    const s = String(h == null ? '' : h).trim().toLowerCase();
    if (!s || s.length > 20) return; // 차트 시트의 긴 설명 텍스트 헤더 오탐 방지
    if (RESULT_HEADER_EXACT.has(s) ||
        (RESULT_HEADER_RE.test(s) && !RESULT_HEADER_EXCLUDE_RE.test(s))) {
      candidates.push(i);
    }
  });
  let cols = candidates.filter(i => isResultColumnByProfile(rows, i, 1));
  if (cols.length === 0) {
    // 별칭으로 못 찾음 → 전 컬럼 값 프로파일 스캔 (헤더명이 특이한 시트 대응)
    cols = header.map((_, i) => i).filter(i => isResultColumnByProfile(rows, i, 3));
  }
  return cols;
}

function findTcIdColumn(header) {
  return header.findIndex(h => /^(tc[ _-]?id|id|no\.?|#)$/i.test(String(h == null ? '' : h).trim()));
}

// sheetData: sheet-store 저장 포맷 { sheets: [{name, header, rows}] }
function computeStatsFromSheetData(sheetData) {
  const result = {
    total: 0, pass: 0, fail: 0, skip: 0, na: 0,
    executed: 0, passRate: 0, executionRate: 0,
    sheets: [], failItems: [],
  };
  for (const sheet of (sheetData && sheetData.sheets) || []) {
    const header = (sheet.header || []).map(h => String(h == null ? '' : h));
    const rows = sheet.rows || [];
    const cols = detectResultColumns(header, rows);
    if (cols.length === 0) continue; // 결과 컬럼 없는 시트(차트·커버리지 등)는 통계 제외

    const idCol = findTcIdColumn(header);
    const st = { name: sheet.name, pass: 0, fail: 0, skip: 0, na: 0, total: 0 };
    for (const row of rows) {
      if (idCol >= 0 && !String((row && row[idCol]) == null ? '' : row[idCol]).trim()) continue;
      for (const c of cols) {
        const kind = classifyResult(row && row[c]);
        if (kind === 'pass') st.pass++;
        else if (kind === 'fail') {
          st.fail++;
          result.failItems.push({
            sheet: sheet.name,
            cells: row.slice(0, 4).map(v => String(v == null ? '' : v)),
          });
        } else if (kind === 'nt') st.skip++;
        else if (kind === 'na') st.na++;
      }
    }
    st.total = st.pass + st.fail + st.skip; // N/A 모수 제외
    if (st.total + st.na > 0) result.sheets.push(st);
  }

  result.pass = result.sheets.reduce((s, sh) => s + sh.pass, 0);
  result.fail = result.sheets.reduce((s, sh) => s + sh.fail, 0);
  result.skip = result.sheets.reduce((s, sh) => s + sh.skip, 0);
  result.na = result.sheets.reduce((s, sh) => s + sh.na, 0);
  result.total = result.pass + result.fail + result.skip;
  result.executed = result.pass + result.fail;
  result.passRate = result.executed > 0 ? Math.round((result.pass / result.executed) * 100) : 0;
  result.executionRate = result.total > 0 ? Math.round((result.executed / result.total) * 100) : 0;
  result.failItems = result.failItems.slice(0, 20);
  return result;
}

// Fail 항목 전체 수집 (통계의 20건 캡 없이) — Fail 분석용
function collectFailItems(sheetData) {
  const fails = [];
  for (const sheet of (sheetData && sheetData.sheets) || []) {
    const header = (sheet.header || []).map(h => String(h == null ? '' : h));
    const rows = sheet.rows || [];
    const cols = detectResultColumns(header, rows);
    if (cols.length === 0) continue;
    const idCol = findTcIdColumn(header);
    for (const row of rows) {
      if (idCol >= 0 && !String((row && row[idCol]) == null ? '' : row[idCol]).trim()) continue;
      for (const c of cols) {
        if (classifyResult(row && row[c]) === 'fail') {
          fails.push({ sheet: sheet.name, cells: row.slice(0, 4).map(v => String(v == null ? '' : v)) });
        }
      }
    }
  }
  return fails;
}

module.exports = { classifyResult, detectResultColumns, findTcIdColumn, computeStatsFromSheetData, collectFailItems };
