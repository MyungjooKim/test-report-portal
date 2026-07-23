// TC Manager 스냅샷 어댑터 (test-run — tc-man API 직결 B안)
// ─────────────────────────────────────────────────────────────────────────
// tc-man GET /api/export/snapshots/:id 페이로드를 수행 보드 TC 행으로 변환한다.
// tc-sheet 어댑터와 같은 출력 계약 — 보드 생성 이후 흐름(그리드·파생·발행)은 공통.
//
// Sheets 경유 대비 이점: coveragePercent(최종 자동 파생 규칙의 입력)와
// 거래소 매핑(대상 외 셀 비활성)이 원본 그대로 전달된다.

const { platformOf } = require('./manual-sheet');

const PRIORITY_MAP = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

// parse(payload) → { tcs, detected }
// payload = tc-man 응답: { snapshot: {version, ...}, exchanges: [...], tcs: [...] }
function parse(payload) {
  const src = (payload && payload.tcs) || [];
  const tcs = src.map(t => ({
    tcId: t.tcId,
    title: t.category3 || t.category2 || null,
    category1: t.category1 || null,
    category2: t.category2 || null,
    precondition: t.precondition || null,
    steps: t.steps || null,
    expected: t.expectedResult || null,
    priority: PRIORITY_MAP[t.priority] || null,
    targetExchanges: Array.isArray(t.exchanges) ? t.exchanges : [], // [] = 공통(전 거래소 대상)
    smoke: !!t.isSmoke,
    screenCode: (t.screenCodes || []).join(' ') || null,
    programIds: (t.programIds || []).join(', ') || null,
    coveragePct: t.coveragePercent != null ? t.coveragePercent : null,
    coverageNote: t.coverageNote || null,
    automation: t.automationStatus || null,
    platform: platformOf(t.tcId),
    sheet: t.suite || null,
  }));

  const platforms = [...new Set(tcs.map(t => t.platform).filter(Boolean))];
  return {
    tcs,
    detected: {
      format: 'tcman-snapshot',
      snapshotVersion: payload && payload.snapshot ? payload.snapshot.version : null,
      tcCount: tcs.length,
      platforms,
      exchanges: (payload && payload.exchanges) || [],
    },
  };
}

module.exports = { parse };
