// 결과 취합 — 정규화 레코드(§8.1) → TC ID 기준 pivot + 통계
// ─────────────────────────────────────────────────────────────────────────
// docs/RESULT_CONSOLIDATION_SPEC.md §8.4 병합·pivot 규칙 구현.
// 입력: 어댑터가 뱉은 정규화 레코드 배열
//   { tcId, source, result, resultRaw, exchange, env, snapshot,
//     reasonNote, durationMs, title, suite, flaky, untagged, coveredByMulti, attachments }
// 출력: { rows, stats, sources, untagged }
//
// pivot 행 = (tcId [+ exchange]) 하나. 열 = 소스(manual/automation/…).
// 최종 상태:
//   결정값(Pass/Fail/Blocked) 소스가 없으면 → N/T
//   모든 결정 소스가 같으면 → 그 값
//   다르면 → mismatch, 최종은 보수적으로 Fail
//   하나만 있으면 → 그 값

// 심각도(높을수록 우선) — 한 소스 안에서 같은 TC가 여러 결과일 때 worst-wins.
const SEVERITY = { 'Fail': 3, 'Blocked': 2, 'Pass': 1, 'N/T': 0 };
const DECISIVE = new Set(['Pass', 'Fail', 'Blocked']);

function worst(results) {
  let best = null;
  for (const r of results) {
    if (best === null || (SEVERITY[r] || 0) > (SEVERITY[best] || 0)) best = r;
  }
  return best;
}

function rowKeyOf(tcId, exchange, byExchange) {
  return byExchange && exchange ? `${tcId} ${exchange}` : tcId;
}

// records → 취합 결과.
// opts.byExchange (기본 true): 거래소가 있으면 (tcId, exchange)로 행 분리.
function consolidate(records, opts = {}) {
  const byExchange = opts.byExchange !== false;
  const groups = new Map();     // rowKey → { tcId, exchange, sources: Map<source, {results,reasons,flaky,attachments,titles}> }
  const untagged = [];
  const sourceSet = new Set();

  for (const rec of records || []) {
    if (rec.untagged || !rec.tcId) { untagged.push(rec); continue; }
    const source = rec.source || 'unknown';
    sourceSet.add(source);
    const key = rowKeyOf(rec.tcId, rec.exchange, byExchange);
    if (!groups.has(key)) {
      groups.set(key, { tcId: rec.tcId, exchange: byExchange ? (rec.exchange || null) : null, suite: rec.suite || null, sources: new Map() });
    }
    const g = groups.get(key);
    if (!g.suite && rec.suite) g.suite = rec.suite;
    if (!g.sources.has(source)) {
      g.sources.set(source, { results: [], reasons: [], flaky: false, attachments: 0, titles: new Set() });
    }
    const cell = g.sources.get(source);
    if (rec.result) cell.results.push(rec.result);
    if (rec.reasonNote) cell.reasons.push(rec.reasonNote);
    if (rec.flaky) cell.flaky = true;
    if (Array.isArray(rec.attachments)) cell.attachments += rec.attachments.length;
    if (rec.title) cell.titles.add(rec.title);
  }

  const rows = [];
  for (const g of groups.values()) {
    const sources = {};
    const decisiveVals = [];
    for (const [src, cell] of g.sources) {
      const agg = worst(cell.results) || 'N/T';
      sources[src] = {
        result: agg,
        flaky: cell.flaky,
        reason: cell.reasons[0] || null,
        attachments: cell.attachments,
        titles: [...cell.titles],
      };
      if (DECISIVE.has(agg)) decisiveVals.push(agg);
    }
    const uniqDecisive = [...new Set(decisiveVals)];
    let final, mismatch = false;
    if (uniqDecisive.length === 0) final = 'N/T';
    else if (uniqDecisive.length === 1) final = uniqDecisive[0];
    else { mismatch = true; final = 'Fail'; } // 불일치 → 보수적 Fail

    rows.push({ tcId: g.tcId, exchange: g.exchange, suite: g.suite, sources, final, mismatch });
  }

  // 정렬: 불일치 먼저, 그다음 Fail, 그다음 tcId
  rows.sort((a, b) => {
    if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1;
    const fa = a.final === 'Fail' ? 0 : 1, fb = b.final === 'Fail' ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (a.tcId !== b.tcId) return a.tcId < b.tcId ? -1 : 1;
    return String(a.exchange || '').localeCompare(String(b.exchange || ''));
  });

  const sourceNames = [...sourceSet].sort();
  const stats = computeStats(rows, sourceNames, untagged.length);
  return {
    rows,
    stats,
    sources: sourceNames,
    axes: computeAxes(rows, sourceNames),
    failReasons: computeFailReasons(rows),
    untagged: { count: untagged.length, items: untagged.slice(0, 100) },
  };
}

// ── 축별 분포 (스펙 §9.3-②) ──────────────────────────────────────────────
// 스택 바 한 줄 분량의 카운트. Blocked는 시각화에서 fail 쪽으로 집계.
function emptyCounts() { return { pass: 0, fail: 0, nt: 0, na: 0, total: 0 }; }

function addFinal(c, final) {
  if (final === 'Pass') c.pass++;
  else if (final === 'N/T') c.nt++;
  else c.fail++; // Fail + Blocked
  c.total++;
}

// rows → [{ key, name, values: [{ value, pass, fail, nt, na, total }] }]
// - exchange/suite: 행의 최종 상태 분포. 값이 있는 행이 하나도 없으면 축 자체를 생략.
// - source: 소스별 결과 분포. na = 해당 소스에 결과가 없는 행(미커버) → 바 길이가 커버리지를 보여줌.
function computeAxes(rows, sourceNames) {
  const axes = [];

  const groupBy = (getter) => {
    const m = new Map();
    for (const r of rows) {
      const v = getter(r);
      if (!v) continue;
      if (!m.has(v)) m.set(v, emptyCounts());
      addFinal(m.get(v), r.final);
    }
    return m;
  };
  const toValues = (m) => [...m.entries()]
    .map(([value, c]) => ({ value, ...c }))
    .sort((a, b) => b.total - a.total || String(a.value).localeCompare(String(b.value)));

  const exch = toValues(groupBy(r => r.exchange));
  if (exch.length) axes.push({ key: 'exchange', name: '거래소별', values: exch });

  let suites = toValues(groupBy(r => r.suite));
  if (suites.length > 12) { // 상위 12개 + 나머지 합산
    const rest = suites.slice(12).reduce((acc, v) => {
      acc.pass += v.pass; acc.fail += v.fail; acc.nt += v.nt; acc.total += v.total; return acc;
    }, { value: `기타 (${suites.length - 12}개)`, ...emptyCounts() });
    suites = [...suites.slice(0, 12), rest];
  }
  if (suites.length) axes.push({ key: 'suite', name: '영역별 (suite)', values: suites });

  if (sourceNames.length >= 2) { // 단일 소스면 요약 밴드와 중복이라 생략
    const values = sourceNames.map(src => {
      const c = emptyCounts();
      for (const r of rows) {
        const cell = r.sources[src];
        if (cell) addFinal(c, cell.result);
        else c.na++; // 이 소스에 결과 없음(미커버)
      }
      return { value: src, ...c };
    });
    axes.push({ key: 'source', name: '소스별', values });
  }
  return axes;
}

// ── Fail 사유 패턴 그룹핑 (스펙 §9.3-③) ─────────────────────────────────
// 사유 원문에서 안정적인 시그니처를 뽑아 같은 유형끼리 묶는다.
function reasonPattern(reason) {
  const s = String(reason).split('\n')[0].trim();
  let m = s.match(/expect\([^)]*\)\.(\w+)\(/); // Playwright expect(locator).toXxx(...)
  if (m) return `expect(…).${m[1]}() failed`;
  m = s.match(/^([A-Za-z]*Error):\s*([^:]+)/);  // TimeoutError: browserContext.waitForEvent: …
  if (m) return `${m[1]}: ${m[2].trim()}`.slice(0, 80);
  const norm = s.replace(/\d+/g, 'N').replace(/["'][^"']*["']/g, '…'); // 숫자·리터럴 제거로 안정화
  return norm.slice(0, 80) || '(사유 없음)';
}

// rows → 상위 8개 [{ pattern, count, keys }] (count = 해당 패턴이 잡힌 행 수,
// keys = 행 식별자 `tcId exchange` — 프론트 pivot 필터용)
function computeFailReasons(rows, topN = 8) {
  const map = new Map();
  for (const r of rows) {
    const rowKey = `${r.tcId} ${r.exchange || ''}`;
    const seen = new Set();
    for (const cell of Object.values(r.sources)) {
      if (cell.result !== 'Fail' && cell.result !== 'Blocked') continue;
      if (!cell.reason) continue;
      const p = reasonPattern(cell.reason);
      if (seen.has(p)) continue; // 같은 행에서 같은 패턴은 1회만
      seen.add(p);
      if (!map.has(p)) map.set(p, { pattern: p, count: 0, keys: [] });
      const g = map.get(p);
      g.count++;
      g.keys.push(rowKey);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, topN);
}

function computeStats(rows, sourceNames, untaggedCount) {
  const byFinal = { Pass: 0, Fail: 0, 'N/T': 0, Blocked: 0 };
  let mismatch = 0;
  const withSource = {}; // source → 결정값 있는 행 수
  sourceNames.forEach(s => { withSource[s] = 0; });

  for (const r of rows) {
    byFinal[r.final] = (byFinal[r.final] || 0) + 1;
    if (r.mismatch) mismatch++;
    for (const s of sourceNames) {
      const cell = r.sources[s];
      if (cell && DECISIVE.has(cell.result)) withSource[s]++;
    }
  }

  const totalTc = rows.length;
  const executed = byFinal.Pass + byFinal.Fail + byFinal.Blocked;
  const passRate = executed > 0 ? Math.round((byFinal.Pass / executed) * 100) : 0;
  const coverage = {};
  for (const s of sourceNames) {
    coverage[s] = totalTc > 0 ? Math.round((withSource[s] / totalTc) * 100) : 0;
  }

  return {
    totalTc, byFinal, executed, passRate,
    mismatch, untagged: untaggedCount,
    coverage, // source별 커버리지 % (예: automation 커버리지)
  };
}

module.exports = { consolidate, computeStats, computeAxes, computeFailReasons, reasonPattern, worst, SEVERITY };
