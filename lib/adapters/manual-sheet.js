// 매뉴얼 결과 시트 어댑터 (Phase 2, docs/RESULT_CONSOLIDATION_PHASE2_DESIGN.md §6)
// ─────────────────────────────────────────────────────────────────────────
// QA 팀 매뉴얼 테스트 결과(Google Sheets/XLSX/CSV)를 정규화 레코드로 변환한다.
// 기존 검증 로직 조합: sheet-store.normalizeSheet(헤더 행 탐지·다단 헤더·반복 제거)
// + report-stats.classifyResult/detectResultColumns(결과 컬럼 자동 감지).
//
// 입력: sheet-store 포맷 { sheets: [{name, header, rows}] } 또는 raw allData { 시트명: rows[][] }
// 반환 계약(§7 ResultAdapter):
//   supports(input) -> boolean            (채택 가능한 시트가 1개 이상)
//   parse(input, opts) -> { rows: NormalizedRecord[], detected: {...} }
//
// 확정 결정 반영:
//   D2 시트 자동 감지 — TC ID + 결과 컬럼이 모두 감지된 시트만 채택, 요약 시트 자동 배제
//   D3 TC당 대표값 1개 — 환경×테스터 결과는 Fail > Blocked > Pass > N/T 로 합산,
//      N/A 는 모든 환경이 N/A 일 때만. 원본은 envResults 로 보존
//   D4 TC ID 프리픽스 = 플랫폼 — SC-: pc-web, SCM-: mobile-web (미등록은 프리픽스 그대로)

const { classifyResult, detectResultColumns } = require('../report-stats');
const { normalizeSheet } = require('../sheet-store');

const TC_ID_RE = /^([A-Z]{2,5})(?:-[A-Z0-9]+)+-\d+$/;

// D4 — 조직 규칙. 추후 프리픽스 추가 시 여기(또는 서버 설정)만 확장.
const PLATFORM_BY_PREFIX = { SC: 'pc-web', SCM: 'mobile-web' };

function platformOf(tcId) {
  const m = String(tcId).match(/^([A-Z]+)-/);
  if (!m) return null;
  return PLATFORM_BY_PREFIX[m[1]] || m[1];
}

// 대표값 우선순위 (D3) — 실행값 우선, N/A 는 최후
const REPRESENTATIVE_ORDER = ['Fail', 'Blocked', 'Pass', 'N/T', 'N/A'];

function representative(results) {
  for (const r of REPRESENTATIVE_ORDER) {
    if (results.includes(r)) return r;
  }
  return 'N/T';
}

// 중요도 정규화 — High/Medium/Low 3단계 (미지 어휘는 무시)
function normalizePriority(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^(높음|상|high|h|critical|p0|p1)$/.test(s)) return 'High';
  if (/^(보통|중|medium|m|normal|p2)$/.test(s)) return 'Medium';
  if (/^(낮음|하|low|l|minor|p3)$/.test(s)) return 'Low';
  return null;
}
const PRIORITY_ORDER = ['High', 'Medium', 'Low'];

// report-stats.classifyResult 확장 — Blocked 어휘 추가 (기존 모듈은 무회귀 유지)
const CLASS_TO_RESULT = { pass: 'Pass', fail: 'Fail', nt: 'N/T', na: 'N/A' };

function classify(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(block|blocked|blocking|차단)$/.test(s)) return 'Blocked';
  const kind = classifyResult(s);
  return kind ? CLASS_TO_RESULT[kind] : null;
}

// ── 컬럼 탐지 ────────────────────────────────────────────────────────────

// TC ID 컬럼: ① 헤더명 매칭 → ② 값 프로파일(패턴 매칭 비율) 폴백
function findTcIdCol(header, rows) {
  const byName = header.findIndex(h => /^tc[ _-]?id$/i.test(String(h == null ? '' : h).trim()));
  if (byName >= 0) return byName;
  for (let c = 0; c < header.length; c++) {
    let nonEmpty = 0, matched = 0;
    for (const row of rows) {
      const v = String((row && row[c]) == null ? '' : row[c]).trim();
      if (!v) continue;
      nonEmpty++;
      if (TC_ID_RE.test(v)) matched++;
    }
    if (nonEmpty >= 3 && matched / nonEmpty >= 0.6) return c;
  }
  return -1;
}

// 결과 컬럼 라벨 — normalizeSheet 가 header 를 superHeader 로 이미 보충하므로
// subHeader 만 조합하면 "Win/MAC-Tester 1" 형태가 된다 (v0.8.3 문법 승계)
function columnLabel(sheet, c) {
  const h = String((sheet.header || [])[c] || '').trim();
  const sub = String((sheet.subHeader || [])[c] || '').trim();
  if (h && sub && h !== sub) return `${h}-${sub}`;
  return h || sub || `열${c + 1}`;
}

function findLabeledCol(header, re, exclude = new Set()) {
  return header.findIndex((h, i) => !exclude.has(i) && re.test(String(h == null ? '' : h).trim()));
}

// ── 시트 1개 분석 ────────────────────────────────────────────────────────
// 반환: { adopted, reason?, tcIdCol, resultCols, naReasonCol, titleCol, rowCount }
function analyzeSheet(sheet) {
  const header = sheet.header || [];
  const rows = sheet.rows || [];
  if (!rows.length) return { adopted: false, reason: '데이터 없음' };

  const tcIdCol = findTcIdCol(header, rows);
  if (tcIdCol < 0) return { adopted: false, reason: 'TC ID 컬럼 없음' };

  const resultCols = detectResultColumns(header.map(h => String(h == null ? '' : h)), rows)
    .filter(c => c !== tcIdCol);
  if (!resultCols.length) return { adopted: false, reason: '결과 컬럼 없음' };

  const validRows = rows.filter(r => TC_ID_RE.test(String((r && r[tcIdCol]) == null ? '' : r[tcIdCol]).trim()));
  if (!validRows.length) return { adopted: false, reason: 'TC ID 패턴 매칭 행 없음' };

  const resultSet = new Set(resultCols);
  const naReasonCol = findLabeledCol(header, /(n\/a\s*사유|사유|특이사항|비고|remark|note|comment)/i, resultSet);
  const titleCol = findLabeledCol(header, /^(소분류|항목|케이스명|title|제목|시나리오)$/i, resultSet);
  const priorityCol = findLabeledCol(header, /^(중요도|우선\s?순위|priority)$/i, resultSet);
  // TC 문서 컬럼 (P5, jira-export 매뉴얼 Description 용) — 동의어는 tcgenerator 표준과 동일
  const preconditionCol = findLabeledCol(header, /^(사전\s*조건|precondition)$/i, resultSet);
  const stepsCol = findLabeledCol(header, /^(테스트\s*스텝|테스트\s*단계|수행\s*절차|steps?)$/i, resultSet);
  const expectedCol = findLabeledCol(header, /^(기대\s*결과|예상\s*결과|expected(\s*result)?)$/i, resultSet);

  return {
    adopted: true, tcIdCol, resultCols, naReasonCol, titleCol, priorityCol,
    preconditionCol, stepsCol, expectedCol, rowCount: validRows.length,
  };
}

// ── 입력 정규화 ──────────────────────────────────────────────────────────
// raw allData({시트명: rows[][]}) → sheet-store 포맷, 이후 normalizeSheet 적용
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

// ── 어댑터 계약 ──────────────────────────────────────────────────────────

function supports(input) {
  try {
    return toSheets(input).some(s => analyzeSheet(s).adopted);
  } catch (_) {
    return false;
  }
}

// parse(input, opts) → { rows: NormalizedRecord[], detected }
// opts: { source='manual', snapshot=null }
function parse(input, opts = {}) {
  const source = opts.source || 'manual';
  const snapshot = opts.snapshot || null;
  const sheets = toSheets(input);

  const detectedSheets = [];
  const byTc = new Map(); // tcId → { envResults, naReasons, titles, sheets }

  for (const sheet of sheets) {
    const a = analyzeSheet(sheet);
    if (!a.adopted) {
      detectedSheets.push({ name: sheet.name, adopted: false, reason: a.reason, rowCount: 0 });
      continue;
    }
    const resultLabels = a.resultCols.map(c => columnLabel(sheet, c));
    detectedSheets.push({
      name: sheet.name, adopted: true, rowCount: a.rowCount,
      tcIdLabel: columnLabel(sheet, a.tcIdCol), resultLabels,
    });

    for (const row of sheet.rows) {
      const tcId = String((row && row[a.tcIdCol]) == null ? '' : row[a.tcIdCol]).trim();
      if (!TC_ID_RE.test(tcId)) continue; // 소계·빈 행·설명 행 배제

      if (!byTc.has(tcId)) byTc.set(tcId, { envResults: [], naReasons: [], titles: [], priorities: [], preconditions: [], stepsTexts: [], expecteds: [], sheets: new Set() });
      const acc = byTc.get(tcId);
      acc.sheets.add(sheet.name);

      a.resultCols.forEach((c, i) => {
        const result = classify(row[c]);
        if (!result) return; // 빈값·분류 불가는 결과 없음으로 취급
        acc.envResults.push({ env: resultLabels[i], result, raw: String(row[c]).trim() });
      });
      if (a.naReasonCol >= 0) {
        const reason = String((row[a.naReasonCol]) == null ? '' : row[a.naReasonCol]).trim();
        if (reason) acc.naReasons.push(reason);
      }
      if (a.titleCol >= 0) {
        const t = String((row[a.titleCol]) == null ? '' : row[a.titleCol]).trim();
        if (t) acc.titles.push(t);
      }
      if (a.priorityCol >= 0) {
        const p = normalizePriority(row[a.priorityCol]);
        if (p) acc.priorities.push(p);
      }
      // TC 문서 컬럼 (P5) — 셀 내 개행 보존, TC 당 첫 값 사용
      for (const [col, arr] of [[a.preconditionCol, acc.preconditions], [a.stepsCol, acc.stepsTexts], [a.expectedCol, acc.expecteds]]) {
        if (col >= 0) {
          const v = String((row[col]) == null ? '' : row[col]).trim();
          if (v) arr.push(v);
        }
      }
    }
  }

  const records = [];
  for (const [tcId, acc] of byTc) {
    const results = acc.envResults.map(e => e.result);
    const result = results.length ? representative(results) : 'N/T';
    records.push({
      tcId,
      source,
      result,
      resultRaw: acc.envResults.map(e => `${e.env}:${e.raw}`).join(' / ') || null,
      envResults: acc.envResults.map(({ env, result }) => ({ env, result })),
      naReason: acc.naReasons[0] || null,
      // Fail/Blocked 도 사유 노출 — 취합 표 사유 컬럼·Jira Actual Result 에 사용 (P5)
      reasonNote: ['N/A', 'Fail', 'Blocked'].includes(result) ? (acc.naReasons[0] || null) : null,
      precondition: acc.preconditions[0] || null,
      steps: acc.stepsTexts[0] || null,
      expected: acc.expecteds[0] || null,
      priority: PRIORITY_ORDER.find(p => acc.priorities.includes(p)) || null,
      sheet: [...acc.sheets].join(', '),
      suite: [...acc.sheets][0] || null,
      platform: platformOf(tcId),
      exchange: null,
      env: null,
      snapshot,
      title: acc.titles[0] || null,
      untagged: false,
    });
  }

  const platforms = [...new Set(records.map(r => r.platform).filter(Boolean))];
  return {
    rows: records,
    detected: {
      format: 'manual-sheet',
      sheets: detectedSheets,
      rowCount: records.length,
      platforms,
      snapshot,
    },
  };
}

module.exports = { supports, parse, analyzeSheet, findTcIdCol, classify, representative, platformOf, normalizePriority, TC_ID_RE, PLATFORM_BY_PREFIX };
