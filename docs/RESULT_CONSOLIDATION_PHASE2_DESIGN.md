# 결과 취합 Phase 2 — 매뉴얼 소스 어댑터 + 공통 업로드 위저드 설계

> 작성: 2026-07-22 · 기준 스펙: [`RESULT_CONSOLIDATION_SPEC.md`](./RESULT_CONSOLIDATION_SPEC.md) §5–6.1, §10, §11
> 선행 구현: Phase 0~3 + 대시보드 재구성 + 업로드 자동 감지(2026-07-22) — [`RESULT_CONSOLIDATION_HANDOFF.md`](./RESULT_CONSOLIDATION_HANDOFF.md)

---

## 1. 목적

Playwright(자동화) 단일 소스로 동작 중인 결과 취합에 **매뉴얼 결과 소스(Google Sheets/XLSX/CSV)** 를 추가해,
같은 TC의 매뉴얼 vs 자동화 결과를 비교(**불일치 검출**)할 수 있게 한다.
동시에 업로드 UX를 §11 합의 플로우(양식 선택 → 매핑 확인 → 미리보기 → 취합)로 재구성한다.

## 2. 확정 결정 (2026-07-22, 사용자 확정)

| # | 결정 | 내용 |
|---|------|------|
| D1 | **N/A 모수 제외** | N/A = 테스트 범위 밖(미개발·테스트 불필요 판정). 모수(전체 TC) = P+F+N/T 로 계산, N/A 는 지표에서 제외하되 별도 카운트로 표시. 실행률 = (P+F)/모수, Pass율 = P/(P+F). N/T(범위 내 미수행)와 명확히 구분. |
| D2 | **시트 자동 감지** | 다중 시트 파일은 TC ID + 결과 컬럼이 감지되는 시트를 전부 취합 대상으로 자동 포함. 요약/목차 시트는 자동 배제. 별도 시트 선택 UI 없음 — 미리보기에서 시트별 인식 행 수를 표시. |
| D3 | **매뉴얼 TC당 대표값 1개** | 매뉴얼의 환경×테스터별 결과는 대표값 1개로 합산(Fail > Blocked > Pass > N/T, N/A 는 전 환경 N/A 일 때만). pivot 은 기존 TC×거래소 행 유지, 매뉴얼 컬럼엔 대표값. 환경별 원본 값은 record 에 보존해 행 상세/툴팁으로 노출. |

## 3. 샘플 분석 (설계 근거)

### 파일 A — [SCM] TC 목록 (단일형·헤더 1행)
- 1개 시트 429행. TC ID: `SCM-TRAD-001` 형식(6개 도메인 프리픽스).
- 결과 컬럼 1개(`테스트 통과`): Pass 110 · Fail 9 · N/T 13 · **N/A 276**.
- `자동화 상태`(IMPLEMENTED/NOT_REVIEWED) 컬럼 별도. 거래소 축 없음.
- 함정: 시트 중간 **반복 헤더 5회**, 셀 내 개행으로 컬럼 밀림.

### 파일 B — PARAMETA_Supercycl_TestCase_v3.1 (다중 시트·2행 병합 다단 헤더)
- 요약 시트 + 영역별 TC 시트 다수(헤더 반복 26곳).
- 헤더 2행 병합: 상단 **환경(Win/MAC, MAC)** × 하단 **Tester 1/2** → 결과 컬럼 = 환경×테스터 조합.
- TC ID: `SC-TRD-FTPS-034` — **Playwright `[SC-...]` 와 동일 체계** → 실전 불일치 검증 시나리오.
- 결과값: Pass/Fail/N/T + `실제 결과, N/A 사유, 특이사항` 병합 컬럼.
- 거래소는 축이 아니라 TC 속성(콤마 리스트 `HL, BG, GT`).

### 시사점
1. 결과 컬럼 **자동 감지**(값 어휘 매칭) + **다중 결과 컬럼**(환경×테스터) 지원 필수.
2. 다단 헤더 조합·반복 헤더 제거·헤더 행 탐지는 tcgenerator v0.8.0/v0.8.3/v0.19 계열에서 검증된 로직 재활용(`lib/report-stats.js` 기반).
3. 축 일반화: Playwright=거래소, 파일 B=환경/테스터, 파일 A=축 없음 → 소스별 축은 감지 결과로 기록하되 pivot 병합은 D3 규칙.

## 4. 데이터 모델 확장

```jsonc
// record (매뉴얼 소스) — TC 당 1건 (D3)
{ id, sourceId, projectId,
  tcId, source: 'manual',
  result: 'Pass|Fail|N/T|N/A|Blocked',   // 대표값 (envResults 합산)
  resultRaw,                              // 원본 문자열
  envResults: [                           // 환경×테스터 원본 (보존, D3)
    { env: 'Win/MAC-Tester 1', result: 'Pass' },
    { env: 'MAC-Tester 2', result: 'N/T' }
  ],
  naReason,                               // N/A 사유 컬럼 값
  sheet,                                  // 출처 시트명 (D2 미리보기·추적용)
  exchange: null, env: null, ... }        // 기존 필드 유지
```

- `result` 어휘에 **`N/A` 추가** (기존 4종 → 5종).
- source(소스 파일) 에 `format: 'gsheet'|'xlsx'|'csv'`, `sourceRole: 'manual'`, `detected: { sheets: [{name, rows, headerRow, resultCols}] }` 저장.

## 5. 취합 코어 변경 (`lib/consolidate.js`)

1. **N/A 상태 (D1)**: `byFinal['N/A']` 추가. `totalTc = P+F+N/T` (N/A 제외), `executed = P+F`,
   `passRate = P/executed`, `execRate = executed/totalTc`. N/A 카운트는 stats 에 별도 필드.
2. **최종 상태 판정**: 소스 간 비교(mismatch)는 기존 로직 유지하되, **N/A 는 결정값으로 취급하지 않음**
   (매뉴얼 N/A + 자동화 Pass → 최종 Pass, 불일치 아님 — 범위 밖 선언이므로).
3. worst-wins 순서: `Fail > Blocked > Pass > N/T` 유지. N/A 는 모든 값보다 약함(다른 값이 있으면 그 값).
4. 축 집계(`computeAxes`)에 매뉴얼 `envResults` 기반 **환경축** 추가(소스 2종 이상일 때 노출 — 기존 규칙 승계).

## 6. 매뉴얼 어댑터 (`lib/adapters/manual-sheet.js`)

입력: 시트 데이터(2차원 배열 rows) 배열 — GSheet API(기존 tr_ui gsheet 연동 재활용) / XLSX / CSV 파서가 공급.

파이프라인 (시트별):
1. **헤더 행 탐지** — TC ID 패턴(`/^[A-Z]{2,4}(-[A-Z0-9]+)+-\d+$/`) 컬럼 + 채워진 셀 3개 이상 시그니처 (v0.8.0 로직).
2. **다단 헤더 조합** — 헤더 직전 행에 병합 상단 행이 있으면 `상단-하단` 라벨 결합 (v0.8.3 `superHeader-subHeader`).
3. **반복 헤더/노이즈 제거** — 시트 중간 반복 헤더 행, 컬럼 밀린 행 배제 (파일 A 함정).
4. **결과 컬럼 자동 감지** — 각 컬럼의 값 분포가 결과 어휘(Pass/Fail/N\/T/N\/A/Blocked/통과/실패/보류…)에 일정 비율(≥60%) 매칭되면 결과 컬럼. 복수 감지 시 전부 envResults 로.
5. **시트 채택 판정 (D2)** — TC ID 컬럼과 결과 컬럼이 모두 감지된 시트만 채택. `detected.sheets` 에 채택/배제와 행 수 기록.
6. **정규화** — TC 당 record 1건 (D3 합산), naReason·sheet 채워서 반환.

`supports()` / `parse()` 인터페이스는 Playwright 어댑터와 동일 시그니처로 — §7 어댑터 계층 준수.

## 7. 서버 — preview/commit 2단계 API (스펙 §10)

```
POST /api/projects/:id/consolidate/preview   (multipart: files | gsheetUrl)
  → 파일 저장·파싱만 수행, DB 미반영. 스테이징 항목 생성.
  → { stagingId, detected: { format, sheets[], rowCount, tcIdSample,
      matchPreview: { matched, unmatchedNew, mismatchCount } } }
      // matchPreview 는 기존 records 와의 TC ID 대조 통계 (§6.1 ③)

POST /api/projects/:id/consolidate/commit
  { stagingId, sourceRole, snapshot, overrides? }
  → 스테이징 파싱 결과를 sources/records 로 확정 저장 → consolidated 반영.

DELETE /api/consolidate/staging/:id            // 취소
```

- 스테이징 보관: `db.staging[]` (파싱 결과 + 파일 경로), TTL 24h — 서버 기동/일일 청소 시 만료 제거.
- 기존 `/sources`·`/reports`(결과형 자동 감지) 경로는 **Playwright 즉시 커밋 경로로 당분간 유지**(무회귀),
  위저드 안정화 후 위저드로 일원화.

## 8. 업로드 위저드 UI (§11 공통 플로우)

결과형 프로젝트의 업로드 버튼을 **하나로 통합**("결과 소스 업로드"), 모달을 4단계 위저드로:

| 단계 | 내용 | 비고 |
|------|------|------|
| ① 파일/양식 | 파일 드롭(ZIP/XLSX/CSV) 또는 GSheet URL → 어댑터 `supports()` 자동 감지 + 사용자 확인 | Playwright ZIP 은 감지 후 ②를 요약 표시로 스킵(§11 허용) |
| ② 매핑 확인 | 감지된 시트 목록(채택/배제·행 수), TC ID 컬럼, 결과 컬럼(환경 라벨), N/A 사유 컬럼 표시 — 수정 가능(overrides) | D2: 선택 UI 없음, 표시만 |
| ③ 미리보기 | preview API 결과: 시트별 인식 행 수, 기존 TC 매칭 N / 신규 X / 예상 불일치 통계, 샘플 10행 | |
| ④ 취합 | 소스 태그(manual/automation)·스냅샷 입력 → commit | |

- 문서형 프로젝트의 "리포트 업로드" 모달은 현행 유지(Playwright 감지 안내·전환 배너 포함).

## 9. 수용 기준 (스펙 §13-4 연계)

1. 파일 A 업로드 → 시트 1개 채택, 429행 중 유효 TC 정규화, N/A 276건이 모수에서 제외된 통계.
2. 파일 B 업로드 → 요약 시트 자동 배제, 영역별 시트 전부 채택, 환경×테스터 결과가 TC당 대표값으로 합산.
3. 파일 B + Playwright ZIP 동시 취합 → `SC-` TC ID 교차 매칭, **불일치 행 검출·불일치 필터·불일치 카드 노출**(소스 2종 조건 충족).
4. 미리보기 없이 저장되는 경로 없음(commit 전 DB 무변화), 취소 시 스테이징 정리.
5. 기존 Playwright 단일 소스 프로젝트(데모 포함) 무회귀 — `npm test` 전체 통과 + 데모 시드 수치(773행·73%) 불변.

## 10. 구현 순서

1. `manual-sheet.js` 어댑터 + 단위 테스트 (파일 A/B 패턴 픽스처) — 코어부터
2. `consolidate.js` N/A·envResults 확장 + 테스트 (D1·D3 계산식)
3. preview/commit API + 스테이징
4. 업로드 위저드 UI (버튼 통합 포함)
5. 실데이터 E2E (파일 A/B + pw-report.zip) → 불일치 실검증
