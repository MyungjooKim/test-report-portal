// 상세 대시보드 통계 — 특징 축(거래소/기기/테스터/우선순위 등) 자동 감지 + 축별 결과 분포
//
// 결과서마다 테이블 헤더가 달라 고정 스키마가 불가능하므로:
//  1) 결과 컬럼(기존 detectResultColumns)은 "기기 축"으로 그대로 사용 (Win/MAC, MAC 등 헤더 = 기기명)
//  2) 나머지 컬럼은 값 프로파일로 축 후보 판정 — 카디널리티가 낮은 범주형 컬럼만 축으로 채택
//  3) 감지된 헤더명을 그대로 상세 대시보드 라벨로 표시
//
// 기준값은 data/settings.json 의 detail 섹션으로 재배포 없이 조정 가능 (서버가 병합).
const { classifyResult, detectResultColumns, findTcIdColumn } = require('./report-stats');

const DEFAULT_DETAIL_CONFIG = {
  minAxes: 1,             // 발동 조건: 감지된 축 최소 개수
  minTotal: 10,           // 발동 조건: 결과(실행 단위) 최소 건수
  maxAxisCardinality: 12, // 축 후보: 고유값 상한 (거래소 최대 7 + 여유)
  axisValueMaxLen: 30,    // 축 후보: 값 최대 길이 (사전 조건·스텝 등 서술 컬럼 제외)
  minNonEmpty: 3,         // 축 후보: 비어있지 않은 값 최소 개수
  maxAxes: 8,             // 표시할 축 상한
  maxValuesPerAxis: 20,   // 축당 표시할 값 상한
  // 축에서 제외할 헤더명 (2026-07-16 사용자 지정) — 거래소는 결과 컬럼별 축과 중복,
  // 분류 계열은 시트별 결과와 중복되는 노이즈. settings.json 의 detail.excludeAxes 로 조정 가능
  excludeAxes: ['거래소', '소분류', '중분류', '대분류', '카테고리'],
};

// 잘 알려진 축 헤더 별칭 — 표시 우선순위 부스트
const AXIS_ALIAS_RE = /(거래소|exchange|기기|디바이스|device|플랫폼|platform|테스터|tester|담당|우선순위|priority|smoke|자동화|automation|브라우저|browser|os)/i;

// "GT, BG, HL" 같은 다중값 셀 분해 — '/' 는 N/T, Win/MAC 등 단일 값에 쓰이므로 분해하지 않음
function splitAxisValue(v) {
  return String(v == null ? '' : v).split(/[,·|]/).map(s => s.trim()).filter(Boolean);
}

// 체크마크 표기 정규화 (∨/V/Y 혼재 → ✓)
function normalizeAxisValue(v) {
  return /^[∨✓vV]$|^[yY]$/.test(v) ? '✓' : v;
}

function emptyCounts() {
  return { pass: 0, fail: 0, nt: 0, na: 0, total: 0 };
}

function addCount(counts, kind) {
  counts[kind === 'skip' ? 'nt' : kind]++;
  if (kind !== 'na') counts.total++; // N/A 는 모수 제외 (기존 정책)
}

// 시트 하나에서 축 후보 컬럼 인덱스 탐지
function detectAxisColumns(header, rows, resultCols, idCol, cfg) {
  const resultSet = new Set(resultCols);
  const found = [];
  const excluded = new Set((cfg.excludeAxes || []).map(n => String(n).trim()));
  header.forEach((h, i) => {
    const name = String(h == null ? '' : h).trim();
    if (!name || name.length > 20 || resultSet.has(i) || i === idCol) return;
    if (excluded.has(name)) return;
    const distinct = new Set();
    let nonEmpty = 0;
    let tooLong = false;
    for (const row of rows) {
      const raw = String((row && row[i]) == null ? '' : row[i]).trim();
      if (!raw) continue;
      nonEmpty++;
      for (const v of splitAxisValue(raw)) {
        if (v.length > cfg.axisValueMaxLen) { tooLong = true; break; }
        distinct.add(normalizeAxisValue(v));
      }
      if (tooLong || distinct.size > cfg.maxAxisCardinality) return;
    }
    if (tooLong) return;
    if (nonEmpty < cfg.minNonEmpty) return;
    // 고유값 1개는 축이 아님 — 단, 체크마크 플래그 컬럼(Smoke 등)은 "표시된 부분집합의 결과 분포"로 의미 있음
    const isFlagColumn = distinct.size === 1 && distinct.has('✓');
    if (distinct.size < 2 && !isFlagColumn) return;
    found.push({ index: i, name });
  });
  return found;
}

// sheetData: sheet-store 포맷 (load 시 헤더 정규화 완료 가정)
function computeDetailStats(sheetData, config) {
  const cfg = { ...DEFAULT_DETAIL_CONFIG, ...(config || {}) };
  const axisMap = new Map();   // 축 헤더명 → Map(값 → counts)
  const deviceMap = new Map(); // 결과 컬럼 헤더명 → counts (기기 축)
  let grandTotal = 0;

  for (const sheet of (sheetData && sheetData.sheets) || []) {
    const header = (sheet.header || []).map(h => String(h == null ? '' : h));
    const rows = sheet.rows || [];
    const resultCols = detectResultColumns(header, rows);
    if (resultCols.length === 0) continue;
    const idCol = findTcIdColumn(header);
    const axisCols = detectAxisColumns(header, rows, resultCols, idCol, cfg);

    for (const row of rows) {
      if (idCol >= 0 && !String((row && row[idCol]) == null ? '' : row[idCol]).trim()) continue;

      // 이 행의 축 값들 (다중값 분해)
      const rowAxisValues = axisCols.map(a => ({
        name: a.name,
        values: splitAxisValue((row && row[a.index]) == null ? '' : row[a.index]).map(normalizeAxisValue),
      }));

      for (const c of resultCols) {
        const kind = classifyResult(row && row[c]);
        if (!kind) continue;
        if (kind !== 'na') grandTotal++;

        // 기기 축 — 다단 헤더 조합: 상위(기기) + 헤더 + 서브(테스터/거래소)
        // → "Win/MAC-Tester 1", "MAC-Binance" (템플릿에 따라 기기가 위/아래 어느 쪽에도 올 수 있음)
        const main = String(header[c] || '').trim();
        const sup = String((sheet.superHeader && sheet.superHeader[c]) || '').trim();
        const sub = String((sheet.subHeader && sheet.subHeader[c]) || '').trim();
        const parts = [];
        if (sup && sup !== main) parts.push(sup);
        if (main) parts.push(main);
        if (sub && sub !== main) parts.push(sub);
        const deviceName = parts.join('-') || `열 ${c + 1}`;
        if (!deviceMap.has(deviceName)) deviceMap.set(deviceName, emptyCounts());
        addCount(deviceMap.get(deviceName), kind === 'nt' ? 'nt' : kind);

        // 일반 축 분포
        for (const ax of rowAxisValues) {
          for (const v of ax.values) {
            if (!axisMap.has(ax.name)) axisMap.set(ax.name, new Map());
            const values = axisMap.get(ax.name);
            if (!values.has(v)) values.set(v, emptyCounts());
            addCount(values.get(v), kind === 'nt' ? 'nt' : kind);
          }
        }
      }
    }
  }

  // 정렬: 별칭 매치 축 우선 → 건수 내림차순, 값은 건수 내림차순
  const axes = [...axisMap.entries()]
    .map(([name, values]) => {
      const list = [...values.entries()]
        .map(([value, counts]) => ({ value, ...counts }))
        .sort((a, b) => b.total - a.total)
        .slice(0, cfg.maxValuesPerAxis);
      const total = list.reduce((s, v) => s + v.total, 0);
      return { name, aliasMatch: AXIS_ALIAS_RE.test(name), total, values: list };
    })
    .filter(a => a.total > 0)
    .sort((a, b) => (b.aliasMatch - a.aliasMatch) || (b.total - a.total))
    .slice(0, cfg.maxAxes);

  const devices = [...deviceMap.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.total - a.total);

  return {
    available: axes.length >= cfg.minAxes && grandTotal >= cfg.minTotal,
    total: grandTotal,
    axes,
    devices,
    config: cfg,
  };
}

module.exports = { computeDetailStats, DEFAULT_DETAIL_CONFIG };
