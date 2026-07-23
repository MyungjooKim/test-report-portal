// 테스트 수행 보드 — 최종 파생 규칙·이벤트 투영 테스트 (test-run R1)
const test = require('node:test');
const assert = require('node:assert');
const { deriveFinal, projectRun, runSummary } = require('../lib/run-board');

// ── 최종 파생 규칙표 (plan §최종 결과 자동 파생 규칙 — 사용자 확정 표 전량) ──

test('파생: 디폴트 N/T', () => {
  assert.equal(deriveFinal({ coveragePct: null }).result, 'N/T');
});

test('파생: Fail 은 부분 검증으로도 확정 (worst-wins)', () => {
  assert.equal(deriveFinal({ coveragePct: 50, auto: 'Fail', manual: 'Pass' }).result, 'Fail');
  assert.equal(deriveFinal({ coveragePct: null, auto: 'Pass', manual: 'Fail' }).result, 'Fail');
  assert.equal(deriveFinal({ coveragePct: null, manual: 'Fail' }).result, 'Fail');
});

test('파생: cov100 자동 Pass → Pass', () => {
  assert.equal(deriveFinal({ coveragePct: 100, auto: 'Pass' }).result, 'Pass');
});

test('파생: 매뉴얼 Pass 는 커버리지 무관 단독 Pass 권한', () => {
  assert.equal(deriveFinal({ coveragePct: 0, manual: 'Pass' }).result, 'Pass');
  assert.equal(deriveFinal({ coveragePct: 40, manual: 'Pass' }).result, 'Pass');
  assert.equal(deriveFinal({ coveragePct: 40, auto: 'Pass', manual: 'Pass' }).result, 'Pass');
});

test('파생: 부분 커버리지 자동 Pass 단독 = N/T 유지 + 진행 배지', () => {
  const d = deriveFinal({ coveragePct: 60, auto: 'Pass' });
  assert.equal(d.result, 'N/T');
  assert.equal(d.badge, '🤖 60% 통과');
  // 커버리지 미기재 자동 Pass 도 보수적으로 N/T
  const d2 = deriveFinal({ coveragePct: null, auto: 'Pass' });
  assert.equal(d2.result, 'N/T');
  assert.ok(d2.badge);
});

test('파생: 매뉴얼 N/A → N/A, 단 Fail 이 있으면 Fail 우선(표 행 순서)', () => {
  assert.equal(deriveFinal({ coveragePct: null, manual: 'N/A' }).result, 'N/A');
  assert.equal(deriveFinal({ coveragePct: null, auto: 'Fail', manual: 'N/A' }).result, 'Fail');
});

test('파생: Blocked 는 취합 우선순위 승계 (Fail 다음)', () => {
  assert.equal(deriveFinal({ coveragePct: null, manual: 'Blocked' }).result, 'Blocked');
  assert.equal(deriveFinal({ coveragePct: 100, auto: 'Pass', manual: 'Blocked' }).result, 'Blocked');
});

test('파생: N/T 기입은 신호 없음으로 취급', () => {
  assert.equal(deriveFinal({ coveragePct: 100, auto: 'Pass', manual: 'N/T' }).result, 'Pass');
});

// ── 이벤트 투영 ──

function makeRun() {
  return {
    id: 'r1', exchanges: ['Binance', 'BingX'], targetVersion: 'v1.2.4',
    tcs: [
      { tcId: 'SC-A-001', title: 'a', coveragePct: 100, targetExchanges: [] },
      { tcId: 'SC-A-002', title: 'b', coveragePct: null, targetExchanges: ['Binance'] },
    ],
    events: [],
  };
}

test('투영: 이벤트 없는 셀은 N/T 파생 + events 0', () => {
  const p = projectRun(makeRun());
  const cell = p.tcs[0].cells['Binance'];
  assert.equal(cell.final.result, 'N/T');
  assert.equal(cell.final.source, 'derived');
  assert.equal(cell.events, 0);
});

test('투영: 같은 슬롯은 마지막 이벤트가 현재값, 이력은 events 카운트', () => {
  const run = makeRun();
  run.events.push(
    { id: 'e1', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Pass', by: 'a@x', at: 't1', version: 'v1.2.3' },
    { id: 'e2', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Fail', by: 'b@x', at: 't2', version: 'v1.2.4' },
    { id: 'e3', tcId: 'SC-A-001', exchange: 'Binance', kind: 'note', text: '재확인 필요', by: 'b@x', at: 't3' },
  );
  const cell = projectRun(run).tcs[0].cells['Binance'];
  assert.equal(cell.manual.result, 'Fail');
  assert.equal(cell.manual.by, 'b@x');
  assert.equal(cell.final.result, 'Fail'); // 파생
  assert.equal(cell.events, 3);
});

test('투영: 최종 수동 확정(override)과 해제(result null)', () => {
  const run = makeRun();
  run.events.push(
    { id: 'e1', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Fail', at: 't1' },
    { id: 'e2', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'final', result: 'Pass', by: 'lead@x', at: 't2' },
  );
  let cell = projectRun(run).tcs[0].cells['Binance'];
  assert.equal(cell.final.result, 'Pass');
  assert.equal(cell.final.source, 'confirmed');

  run.events.push({ id: 'e3', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'final', result: null, at: 't3' });
  cell = projectRun(run).tcs[0].cells['Binance'];
  assert.equal(cell.final.result, 'Fail');   // 파생으로 복귀
  assert.equal(cell.final.source, 'derived');
});

test('투영: 거래소 축 없는 보드는 단일 컬럼("")', () => {
  const run = makeRun();
  run.exchanges = [];
  run.events.push({ id: 'e1', tcId: 'SC-A-001', exchange: '', kind: 'result', slot: 'manual', result: 'Pass', at: 't1' });
  const p = projectRun(run);
  assert.deepEqual(Object.keys(p.tcs[0].cells), ['']);
  assert.equal(p.tcs[0].cells[''].final.result, 'Pass');
});

test('요약: 대상 거래소 제한 셀은 모수 제외, Fail 집계', () => {
  const run = makeRun();
  run.events.push(
    { id: 'e1', tcId: 'SC-A-001', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Fail', at: 't1' },
    { id: 'e2', tcId: 'SC-A-002', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Pass', at: 't2' },
  );
  const s = runSummary(run);
  // SC-A-002 는 Binance 전용 → BingX 셀 모수 제외: total = 2(Binance) + 1(BingX)
  assert.equal(s.total, 3);
  assert.equal(s.filled, 2);
  assert.equal(s.fail, 1);
  assert.equal(s.perExchange['Binance'].total, 2);
  assert.equal(s.perExchange['BingX'].total, 1);
  assert.equal(s.perExchange['Binance'].fail, 1);
});

// ── 결과형 발행 (R3 — A안) ──
const { publishRecords } = require('../lib/run-board');

test('발행: 3-소스 — 기입된 슬롯은 automation/manual, 최종은 test-run 으로 항상 발행', () => {
  const run = {
    id: 'r1', name: '7월말 Epic#19-모바일', snapshot: '2607_epic19',
    exchanges: ['Binance', 'BingX'],
    tcs: [
      { tcId: 'SCM-A-001', title: 'a', category1: 'Trade', priority: 'High', coveragePct: 50,
        precondition: 'pre', steps: 'st', expected: 'ex', platform: 'mobile-web', targetExchanges: [] },
      { tcId: 'SCM-A-002', title: 'b', category1: 'Trade', coveragePct: null, platform: 'mobile-web',
        targetExchanges: ['Binance'] },
    ],
    events: [
      { id: 'e0', tcId: 'SCM-A-001', exchange: 'Binance', kind: 'result', slot: 'auto', result: 'Pass', at: 't0' },
      { id: 'e1', tcId: 'SCM-A-001', exchange: 'Binance', kind: 'result', slot: 'manual', result: 'Fail', at: 't1' },
      { id: 'e2', tcId: 'SCM-A-001', exchange: 'Binance', kind: 'note', text: '주문 버튼 미노출', at: 't2' },
    ],
  };
  const recs = publishRecords(run);
  // test-run(최종)은 활성 셀 3개 전부, automation/manual 은 기입된 셀만
  assert.deepEqual(
    { auto: recs.filter(r => r.source === 'automation').length, man: recs.filter(r => r.source === 'manual').length, fin: recs.filter(r => r.source === 'test-run').length },
    { auto: 1, man: 1, fin: 3 },
  );
  assert.ok(recs.every(r => r.snapshot === '2607_epic19' && r.untagged === false));

  const at = (src, ex) => recs.find(r => r.source === src && r.tcId === 'SCM-A-001' && r.exchange === ex);
  assert.equal(at('automation', 'Binance').result, 'Pass');
  assert.equal(at('manual', 'Binance').result, 'Fail');
  assert.equal(at('manual', 'Binance').reasonNote, '주문 버튼 미노출'); // 최신 셀 메모 = 사유
  const fin = at('test-run', 'Binance');
  assert.equal(fin.result, 'Fail');                     // worst-wins 파생
  assert.equal(fin.reasonNote, '주문 버튼 미노출');
  assert.equal(fin.precondition, 'pre');                // Jira Description 재료
  assert.equal(fin.platform, 'mobile-web');
  assert.equal(fin.suite, 'Trade');

  const ntRec = at('test-run', 'BingX');
  assert.equal(ntRec.result, 'N/T');   // 미기입도 최종은 발행 — 결과형 진행률 모수
  assert.equal(ntRec.reasonNote, null);
});

test('발행: 거래소 축 없는 보드는 exchange null 레코드', () => {
  const run = {
    id: 'r2', name: 'b', snapshot: null, exchanges: [],
    tcs: [{ tcId: 'SCM-B-001', coveragePct: null, targetExchanges: [] }],
    events: [{ id: 'e1', tcId: 'SCM-B-001', exchange: '', kind: 'result', slot: 'manual', result: 'Pass', at: 't1' }],
  };
  const recs = publishRecords(run);
  assert.equal(recs.length, 2); // manual + test-run(최종)
  assert.ok(recs.every(r => r.exchange === null));
  assert.equal(recs.find(r => r.source === 'manual').result, 'Pass');
  assert.equal(recs.find(r => r.source === 'test-run').result, 'Pass');
});
