// 커스텀 지표 계산기 (report-ai-qa) — 순수 함수, LLM 이 만든 계산 정의를 결정적으로 평가한다.
//
// metric 정의:
//   { label, sheet: string|null, filter: [조건...], agg: "count"|"ratio", of: [조건...] }
// 조건:
//   { col, op: "eq"|"in"|"contains"|"not_empty", value: string|string[]|null }
//
// 의미:
//   count : filter 를 모두 만족하는 행 수 (분모 = 평가 대상 전체 행)
//   ratio : 분모 = filter 만족 행, 분자 = filter ∧ of 만족 행
//   filter 가 빈 배열이면 전체 행이 분모.
//   sheet 가 null 이면 조건 컬럼이 모두 존재하는 시트들을 합산 평가.

const OPS = ['eq', 'in', 'contains', 'not_empty'];

function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function validateConditions(conds, name) {
  if (!Array.isArray(conds)) return `${name} 는 배열이어야 합니다.`;
  for (const c of conds) {
    if (!c || typeof c.col !== 'string' || !c.col.trim()) return `${name} 조건에 col 이 없습니다.`;
    if (!OPS.includes(c.op)) return `${name} 조건의 op 가 올바르지 않습니다: ${c.op}`;
    if (c.op === 'in' && !Array.isArray(c.value)) return `op=in 은 value 배열이 필요합니다.`;
    if ((c.op === 'eq' || c.op === 'contains') && typeof c.value !== 'string') {
      return `op=${c.op} 는 value 문자열이 필요합니다.`;
    }
  }
  return null;
}

function rowMatches(row, colIndex, cond) {
  const idx = colIndex.get(norm(cond.col));
  const cell = norm(idx === undefined ? '' : row[idx]);
  switch (cond.op) {
    case 'eq': return cell === norm(cond.value);
    case 'in': return cond.value.some(v => cell === norm(v));
    case 'contains': return cond.value !== '' && cell.includes(norm(cond.value));
    case 'not_empty': return cell !== '';
    default: return false;
  }
}

// sheetData: sheet-store 저장 포맷 { sheets: [{name, header, rows}] }
function evaluateMetric(sheetData, def) {
  if (!sheetData || !Array.isArray(sheetData.sheets) || sheetData.sheets.length === 0) {
    return { ok: false, error: '시트 데이터가 없습니다.' };
  }
  if (!def || (def.agg !== 'count' && def.agg !== 'ratio')) {
    return { ok: false, error: 'agg 는 count 또는 ratio 여야 합니다.' };
  }
  const filter = def.filter || [];
  const of = def.of || [];
  const err = validateConditions(filter, 'filter') || validateConditions(of, 'of');
  if (err) return { ok: false, error: err };
  if (def.agg === 'ratio' && of.length === 0) {
    return { ok: false, error: 'agg=ratio 는 of 조건이 필요합니다.' };
  }

  // 평가 대상 시트 선정
  let targets = sheetData.sheets;
  if (def.sheet) {
    targets = targets.filter(s => norm(s.name) === norm(def.sheet));
    if (targets.length === 0) return { ok: false, error: `시트 없음: ${def.sheet}` };
  }

  // 조건에 등장하는 모든 컬럼이 존재하는 시트만 평가
  const requiredCols = [...filter, ...of].map(c => norm(c.col));
  targets = targets.filter(s => {
    const cols = new Set(s.header.map(norm));
    return requiredCols.every(c => cols.has(c));
  });
  if (targets.length === 0) {
    const missing = [...new Set(requiredCols)].join(', ');
    return { ok: false, error: `컬럼 없음: ${missing}` };
  }

  let totalRows = 0;
  let denominator = 0;
  let numerator = 0;
  for (const sheet of targets) {
    const colIndex = new Map(sheet.header.map((h, i) => [norm(h), i]));
    for (const row of sheet.rows) {
      // 완전 빈 행은 제외
      if (!row.some(c => norm(c) !== '')) continue;
      totalRows++;
      const inFilter = filter.every(c => rowMatches(row, colIndex, c));
      if (!inFilter) continue;
      denominator++;
      if (def.agg === 'ratio' && of.every(c => rowMatches(row, colIndex, c))) numerator++;
    }
  }

  if (def.agg === 'count') {
    const percent = totalRows > 0 ? Math.round((denominator / totalRows) * 100) : 0;
    return {
      ok: true, agg: 'count',
      numerator: denominator, denominator: totalRows, percent,
      display: `${denominator}건 / 전체 ${totalRows}건 (${percent}%)`,
    };
  }
  const percent = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  return {
    ok: true, agg: 'ratio',
    numerator, denominator, percent,
    display: denominator > 0 ? `${percent}% (${numerator}/${denominator})` : '분모 0 (해당 행 없음)',
  };
}

module.exports = { evaluateMetric };
