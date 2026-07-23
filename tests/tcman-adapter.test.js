// TC Manager 스냅샷 어댑터 (test-run B안) 테스트
const test = require('node:test');
const assert = require('node:assert');
const adapter = require('../lib/adapters/tcman');

// tc-man GET /api/export/snapshots/:id 실응답 형태 (testcase_manager PR #4)
function samplePayload() {
  return {
    ok: true,
    snapshot: { id: 'snap-1', version: 'v2607', description: '7월말', createdAt: '2026-07-22T00:00:00Z' },
    exchanges: ['Bitget', 'OKX', 'Bybit'],
    tcs: [
      {
        tcId: 'SC-TRD-001', category1: '거래', category2: '레버리지', category3: '0x 입력',
        suite: 'Trading', precondition: '로그인', steps: '1. 입력', expectedResult: '에러',
        priority: 'HIGH', isSmoke: true, screenCodes: ['TRD-01', 'TRD-02'],
        coveragePercent: 80, coverageNote: '부분', automationStatus: 'IMPLEMENTED',
        exchanges: ['OKX'], programIds: ['PRG-001', 'PRG-002'],
      },
      {
        tcId: 'SCM-AUTH-002', category1: '로그인', category2: 'google', category3: null,
        suite: '로그인', precondition: null, steps: '잔액 확인', expectedResult: '표시',
        priority: 'MEDIUM', isSmoke: false, screenCodes: [],
        coveragePercent: null, coverageNote: null, automationStatus: 'NOT_REVIEWED',
        exchanges: [], programIds: [],
      },
    ],
  };
}

test('tcman 변환 — 필드 매핑·플랫폼 프리픽스·detected', () => {
  const { tcs, detected } = adapter.parse(samplePayload());
  assert.equal(tcs.length, 2);

  const t1 = tcs[0];
  assert.equal(t1.tcId, 'SC-TRD-001');
  assert.equal(t1.title, '0x 입력');            // category3 우선
  assert.equal(t1.category1, '거래');
  assert.equal(t1.priority, 'High');            // HIGH → High
  assert.deepEqual(t1.targetExchanges, ['OKX']); // 부분 매핑 = 대상 제한
  assert.equal(t1.smoke, true);
  assert.equal(t1.screenCode, 'TRD-01 TRD-02');
  assert.equal(t1.programIds, 'PRG-001, PRG-002');
  assert.equal(t1.coveragePct, 80);              // 최종 파생 규칙 입력 — Sheets 경유에선 유실되던 값
  assert.equal(t1.automation, 'IMPLEMENTED');
  assert.equal(t1.platform, 'pc-web');           // SC- 프리픽스
  assert.equal(t1.sheet, 'Trading');

  const t2 = tcs[1];
  assert.equal(t2.title, 'google');               // category3 없으면 category2 폴백
  assert.deepEqual(t2.targetExchanges, []);       // 공통 = 전 거래소 활성
  assert.equal(t2.coveragePct, null);
  assert.equal(t2.platform, 'mobile-web');        // SCM-

  assert.equal(detected.format, 'tcman-snapshot');
  assert.equal(detected.snapshotVersion, 'v2607');
  assert.deepEqual(detected.platforms, ['pc-web', 'mobile-web']);
  assert.deepEqual(detected.exchanges, ['Bitget', 'OKX', 'Bybit']);
});

test('tcman 변환 — coveragePercent 0 은 0 으로 보존 (매뉴얼 전담 규칙)', () => {
  const p = samplePayload();
  p.tcs[0].coveragePercent = 0;
  const { tcs } = adapter.parse(p);
  assert.equal(tcs[0].coveragePct, 0);
});
