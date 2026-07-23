// 테스트 수행 보드 — 이벤트 투영·최종 파생 (test-run R1)
// ─────────────────────────────────────────────────────────────────────────
// 모든 기입은 append-only 이벤트(run.events[])이고, 자동/수동/최종 칸과 메모
// 스레드는 이벤트 로그의 투영이다 (plan §스냅샷·대상 버전).
//
// 이벤트: { id, tcId, exchange, kind: 'result'|'note', slot: 'auto'|'manual'|'final',
//           result, text, by, at, version }
//   - kind 'result' + slot 'final' + result null = 최종 수동 확정 해제(파생으로 복귀)
//   - kind 'note' 는 메모(text)만
//
// 최종 파생 규칙 (plan §최종 결과 자동 파생 규칙, 2026-07-23 사용자 확정):
//   "Fail 은 부분 검증으로도 확정, Pass 는 전체 검증으로만 확정."
//   매뉴얼 = TC 전체 검증 간주, 자동화 = Coverage% 만큼만 검증 간주.

const RESULTS = ['Pass', 'Fail', 'Blocked', 'N/T', 'N/A'];

// 규칙표를 행 순서대로 적용 — 먼저 매칭되는 행이 승리 (Fail > Blocked > N/A > Pass)
function deriveFinal({ coveragePct, auto, manual }) {
  // N/T 는 "미수행" — 파생 판단에서는 신호 없음으로 취급
  const a = auto && auto !== 'N/T' && auto !== 'N/A' ? auto : null;
  const m = manual && manual !== 'N/T' ? manual : null;

  if (a === 'Fail' || m === 'Fail') return { result: 'Fail' };          // worst-wins
  if (a === 'Blocked' || m === 'Blocked') return { result: 'Blocked' }; // 취합 D 우선순위 승계
  if (m === 'N/A') return { result: 'N/A' };                            // 범위 밖 (취합 D1 동일)
  if (m === 'Pass') return { result: 'Pass' };                          // 매뉴얼 = 전체 검증
  if (a === 'Pass') {
    if (coveragePct != null && coveragePct >= 100) return { result: 'Pass' };
    // 부분 커버리지 자동 Pass 단독 = N/T 유지 + 진행 배지
    return { result: 'N/T', badge: coveragePct != null ? `🤖 ${coveragePct}% 통과` : '🤖 부분 통과' };
  }
  return { result: 'N/T' };
}

// 보드의 거래소 축 키 — 축 없는 보드(모바일 TC 등)는 단일 컬럼 '' 사용
function exchangeKeys(run) {
  return (run.exchanges && run.exchanges.length) ? run.exchanges : [''];
}

// run.events → tcId×exchange 셀 투영
// 반환: Map<`${tcId}|${exchange}`, cell>
//   cell = { auto, manual, override, final: {result, source, badge?, by?, at?, version?}, events }
function projectCells(run) {
  const cells = new Map();
  const byCov = new Map((run.tcs || []).map(t => [t.tcId, t.coveragePct]));
  const cellOf = (tcId, exchange) => {
    const key = `${tcId}|${exchange || ''}`;
    if (!cells.has(key)) cells.set(key, { auto: null, manual: null, override: null, events: 0 });
    return cells.get(key);
  };

  for (const ev of run.events || []) {
    const cell = cellOf(ev.tcId, ev.exchange);
    cell.events++;
    if (ev.kind !== 'result') continue;
    const entry = { result: ev.result, by: ev.by || null, at: ev.at, version: ev.version || null };
    if (ev.slot === 'auto') cell.auto = entry;
    else if (ev.slot === 'manual') cell.manual = entry;
    else if (ev.slot === 'final') cell.override = ev.result ? entry : null; // null = 확정 해제
  }

  for (const [key, cell] of cells) {
    const tcId = key.slice(0, key.lastIndexOf('|'));
    if (cell.override) {
      cell.final = { ...cell.override, source: 'confirmed' };
    } else {
      const d = deriveFinal({
        coveragePct: byCov.get(tcId) != null ? byCov.get(tcId) : null,
        auto: cell.auto && cell.auto.result,
        manual: cell.manual && cell.manual.result,
      });
      cell.final = { ...d, source: 'derived' };
    }
    delete cell.override;
  }
  return cells;
}

// GET /api/runs/:id 응답용 — tcs 에 cells 를 붙인 투영본 (events 원본은 내리지 않음)
function projectRun(run) {
  const cells = projectCells(run);
  const exchanges = exchangeKeys(run);
  const tcs = (run.tcs || []).map(tc => {
    const tcCells = {};
    for (const ex of exchanges) {
      const cell = cells.get(`${tc.tcId}|${ex}`);
      tcCells[ex] = cell || { auto: null, manual: null, final: { ...deriveFinal({ coveragePct: tc.coveragePct }), source: 'derived' }, events: 0 };
    }
    return { ...tc, cells: tcCells };
  });
  return { ...run, events: undefined, tcs };
}

// 보드 목록·요약 밴드용 통계 — 활성 셀(대상 거래소 제한 반영) 기준
function runSummary(run) {
  const cells = projectCells(run);
  const exchanges = exchangeKeys(run);
  const perExchange = {};
  for (const ex of exchanges) perExchange[ex] = { total: 0, filled: 0, fail: 0 };
  let total = 0, filled = 0, fail = 0;

  for (const tc of run.tcs || []) {
    for (const ex of exchanges) {
      // 대상 거래소가 명시된 TC 는 대상 외 셀을 모수에서 제외
      if (ex && tc.targetExchanges && tc.targetExchanges.length && !tc.targetExchanges.includes(ex)) continue;
      const s = perExchange[ex];
      s.total++; total++;
      const cell = cells.get(`${tc.tcId}|${ex}`);
      const final = cell && cell.final ? cell.final.result
        : deriveFinal({ coveragePct: tc.coveragePct, auto: cell && cell.auto && cell.auto.result, manual: cell && cell.manual && cell.manual.result }).result;
      if (final && final !== 'N/T') { s.filled++; filled++; }
      if (final === 'Fail') { s.fail++; fail++; }
    }
  }
  return { total, filled, fail, perExchange };
}

module.exports = { RESULTS, deriveFinal, projectCells, projectRun, runSummary, exchangeKeys };
