# 테스트 수행 보드 (test-run)

> 2026-07-23 사용자 협의로 방향 확정. 기존 결과형 프로젝트(사후 취합·분석)와 **다른 성격**의
> "진행 중 작업공간" — TC 양식을 올려 수행 보드를 만들고, 테스터가 기입하고, 자동화 결과가
> 실시간으로 흘러들어오는 화면. 사이드바에 별도 섹션으로 배치.

## Executive Summary

| 항목 | 내용 |
|---|---|
| Feature | test-run — 테스트 수행 보드 (실행 관리) |
| 포지셔닝 | 수행 보드 = 진행 중 기입·실시간 / 결과형 프로젝트 = 확정 결과 사후 분석 |
| 핵심 구조 | TC 행 × 거래소 축, 거래소당 **자동 🤖 / 수동 ✋ / 최종** 3칸 |
| 실시간 | 커스텀 Playwright 리포터가 테스트 종료마다 push, 화면은 폴링(~10초) |

## 확정 요구·결정

1. **TC 양식 업로드**로 보드 생성 (XLSX/CSV/GSheet — 매뉴얼 어댑터의 헤더 탐지·TC 문서 컬럼 수집 재사용)
2. 웹 그리드 뷰: TC 문서 컬럼(사전조건/스텝/기대결과/중요도/자동화 커버리지) + 거래소별 결과 기입 컬럼
3. 테스터가 **드롭다운으로 Pass/Fail 기록** (어휘: Pass/Fail/Blocked/N/T/N/A — 취합과 동일)
4. **자동화 커버리지 컬럼**(예: `자동화 상태` IMPLEMENTED/NOT_REVIEWED)이 있는 TC 는 자동화 결과가 자동 기입, 부족분은 사람이 수동 기입
5. **메모는 셀 단위(TC×거래소)** — 결정
6. **실시간 업로드 = 커스텀 Playwright 리포터** — 결정. 엔지니어 PC 의 `playwright.config.ts` 에 리포터 한 줄 추가, `onTestEnd` 마다 서버 push
7. **거래소 축은 보드 생성 시 지정** — 결정
8. **자동/수동 컬럼 분리 + 최종 컬럼** — 결정(사용자 제안). 덮어쓰기 대신 자동 🤖 과 수동 ✋ 을 각자 기록,
   최종은 별도 칸. 초반에는 값 업데이트/편집 허용하되 **변경 이력은 셀 메모 스레드에 시스템 항목으로 자동 기록**

## 스냅샷·대상 버전 (2026-07-23 추가 협의)

- **snapshot** = 테스트 주기 식별자 (보드 정체성, 생성 시 지정, 불변 — 기존 취합의 snapshot 과 동일 개념)
- **targetVersion** = 현재 테스트 대상 빌드 (수행 중 변경 가능, 변경 이력 run.versionHistory 보존)
- **모든 기입은 append-only 이벤트** — { result, source(auto/manual), by, at, version 자동 스탬프 }.
  자동/수동/최종 칸과 메모 스레드는 이벤트 로그의 투영(이력=메모 결정의 일반화)
- **버전 전환 정책(확정): 유지 + stale 배지** — targetVersion 을 올려도 결과는 지우지 않고,
  구버전에서 기록된 셀에 ⚠ 배지(`Pass @v1.2.3`) + "재검 필요만 보기" 필터 제공
- 리포터의 버전 주입: `APP_VERSION` 환경변수 → 리포터 옵션 → run 현재 targetVersion 순 폴백
  (`APP_VERSION=v1.2.4 npx playwright test`) — run 현재 버전과 다른 유입은 스탬프 유지 + 보드 경고 카운트
- 참고 패턴: 빌드마다 새 Run(TestRail 식)은 주기 현황이 쪼개져 배제, 결과 스탬프 방식(Allure TestOps 계열) 채택

## TC 양식 (2026-07-23 실물 확인 — SCM 모바일 TC 시트)

컬럼: `TC ID | 대분류 | 중분류 | 소분류 | 사전조건 | 테스트 스텝 | 기대결과 | 중요도 | 대상 거래소 | smoke | 화면코드 | Program IDs | Coverage % | Coverage 메모 | 자동화 상태`

- 사전조건/테스트 스텝/기대결과/중요도 = P5 표준 헤더 그대로 → 매뉴얼 어댑터 재사용
- 제목 = `소분류`, 계층 = 대분류/중분류(그룹 헤더로 활용), TC ID 프리픽스로 플랫폼(SCM=mobile-web)
- `대상 거래소` 공란 多 → **거래소 축 없는 보드(결과 컬럼 1개) 허용** 필수. 값 있으면 대상 외 셀 비활성
- `smoke`(TRUE/FALSE) → 추후 "스모크만 수행" 필터 재료
- 기대결과 장문(10줄+) → 그리드에서 행 확장으로 열람 (기존 확장 패널 패턴)
- 신규 수집: smoke·화면코드·Program IDs·Coverage %·Coverage 메모·자동화 상태

## 최종 결과 자동 파생 규칙 (2026-07-23 사용자 확정)

원칙: **Fail 은 부분 검증으로도 확정, Pass 는 전체 검증으로만 확정.**
매뉴얼 수행 = TC 전체 검증 간주, 자동화 = Coverage% 만큼만 검증 간주.

| Coverage | 자동 | 수동 | 최종 |
|---|---|---|---|
| — | — | — | N/T (디폴트) |
| 임의 | Fail | 임의 | Fail (worst-wins) |
| 임의 | 임의 | Fail | Fail |
| 100% | Pass | 없음 | Pass |
| 0% | 없음 | Pass | Pass (매뉴얼 전담) |
| 부분(1~99%) | Pass | 없음 | **N/T 유지 + "🤖 n% 통과" 진행 배지** |
| 부분 | Pass | Pass | Pass |
| 부분 | 없음 | Pass | Pass (매뉴얼 단독 확정 가능) |
| 임의 | 임의 | N/A | N/A (범위 밖 — 취합 D1 동일) |

- 최종 컬럼은 전량 자동 파생 — 사람은 예외 시에만 수동 확정(이력은 셀 메모에 기록)

## 데이터 모델 (스케치)

```jsonc
// db.runs[]
{
  "id": "run-uuid",
  "name": "Supercycl 7월 4주차",
  "snapshot": "2607_bingxbn",                  // 테스트 주기 (불변)
  "targetVersion": "v1.2.4",                   // 현재 대상 빌드 (가변)
  "versionHistory": [{ "version": "v1.2.3", "from": "...", "to": "..." }],
  "exchanges": ["Binance", "BingX"],          // 생성 시 지정 (7)
  "createdAt": "...", "createdBy": "...",
  "status": "active",                          // active | closed
  "uploadToken": "...",                        // 리포터 push 인증용 (보드에서 복사)
  "tcs": [{
    "tcId": "SC-TRD-LVRG-014",
    "title": "0x 입력", "precondition": "...", "steps": "...", "expected": "...",
    "priority": "High", "automation": "IMPLEMENTED",   // TC 양식의 자동화 커버리지
    "cells": {
      "Binance": {
        "auto":   { "result": "Fail", "at": "...", "detail": "에러 첫 줄" },
        "manual": { "result": "Pass", "by": "tester@", "at": "..." },
        "final":  "Fail",                       // 기본 파생(불일치→보수적) + 수동 확정 가능
        "memo": [                               // 셀 단위 스레드 (5·8) — 이력 겸용
          { "type": "auto",   "at": "...", "text": "자동화 Fail 기입 (run #3)" },
          { "type": "edit",   "at": "...", "by": "tester@", "text": "수동 Pass → Fail 변경" },
          { "type": "note",   "at": "...", "by": "tester@", "text": "재현 영상 확인 필요" }
        ]
      }
    }
  }]
}
```

- 최종(final) 파생 기본값: 자동·수동 중 결정값이 하나면 그 값, 둘 다 있고 다르면 보수적 Fail
  (취합 D 규칙과 동일) — 사람이 드롭다운으로 확정 덮어쓰기 가능, 이력은 메모에 남음

## 커스텀 Playwright 리포터 (R2)

```ts
// playwright.config.ts — 엔지니어 PC 설정 (한 줄)
reporter: [['list'], ['./tr-run-reporter.js', {
  base: 'https://tr.rgrg.im', runId: 'run-uuid', token: '...', exchange: 'Binance',
}]]
```
- `onTestEnd`: 제목의 `[SC-...]` 태그 파싱(멀티/범위 태그 규칙 재사용) → `POST /api/runs/:id/auto-results`
  `{ tcId[], exchange, result, title, error 첫 줄, timestamp }` — 토큰 헤더 인증
- 거래소: 리포터 옵션 지정을 기본으로 하되, 미지정 시 리포트 폴더/프로젝트명 `[Binance]` 감지 폴백
- 네트워크 실패 시 로컬 버퍼 후 재시도(간단 큐) — 테스트 실행을 방해하지 않도록 fire-and-forget
- 배포: 단일 파일(js) 제공 — 포털 보드 화면에서 다운로드 + 설정 스니펫 복사 UI

## 화면

- 사이드바에 "🧪 테스트 수행" 섹션(프로젝트 트리와 분리) → 보드 목록 → 보드
- 보드 그리드: 고정 컬럼(TC ID·제목·중요도·자동화) + 거래소×(자동|수동|최종) — 자동 칸은 읽기전용+🤖,
  수동·최종은 드롭다운. 셀 메모는 💬 아이콘 → 팝오버 스레드
- 상단 요약: 거래소별 진행률(기입된 셀/전체), Fail 수, 자동화 커버리지 비율
- 실시간: 10초 폴링(run 의 updatedAt 증분) — Cloudflare 100초 제약상 SSE 대신 폴링

## 단계

| 단계 | 내용 | 산출 |
|---|---|---|
| R1 | 보드 생성(TC 양식 업로드→파싱) + 그리드 + 수동 드롭다운 + 셀 메모/이력 | ✅ v0.15.0 (2026-07-23) |
| R2 | Playwright 리포터 + auto-results API + 자동 칸 실시간 반영(폴링) | 실시간 자동화 기입 |
| R3 | 최종 확정 UX 정리, run 종료(닫기), 결과형 프로젝트로 발행(스냅샷) 연계 | 발행·닫기 ✅ v0.16.0 / Jira 는 발행 경유 |

## 결과형 발행 (R3 — 2026-07-23 사용자 A안 확정 v0.16.0, 시나리오 개정 v0.16.1)

- 보드 최종(final) 칸을 정규화 레코드(source: `test-run`)로 변환해 결과형 프로젝트 소스로 등록
  (lib/run-board.js publishRecords, POST /api/runs/:id/publish)
- **발행 시나리오 (v0.16.1 개정 — 오발송 사고로 사용자 재설계): 보드 1개 = 결과형 프로젝트 1개**
  - 신규 발행: 새 결과형 프로젝트 자동 생성 — 이름(기본=보드명)·폴더 위치만 지정 (mode `new`)
  - 재발행: 연결된 프로젝트로 원클릭, 이전 발행분 교체(upsert) — 대상 선택 없음 (mode `republish`)
  - "새 프로젝트로 발행…": 다른 이름/위치로 재차 발행 — 연결(publishedTo)은 최신으로 이동, 이전 소스는 보존
  - **기존 프로젝트 선택 경로 제거** — 잘못된 프로젝트를 덮어쓸 방법이 없음
  - 웹/모바일 같은 프로젝트 합류는 협의로 배제(2026-07-23) — 보드마다 독립 프로젝트
- 셀 최신 메모 = 발행 레코드의 reasonNote(Fail/Blocked/N/A) — 취합 사유 컬럼·Jira Actual Result 재료
- 대상 거래소 외 셀은 발행 제외, N/T 도 발행(진행률 모수), TC 문서 컬럼 동봉(Jira Description P5 재료)
- 라이브 연결은 배제 — 진행 중 값이 확정 대시보드에 섞여 결과형 정체성 훼손

## TC Manager(tc-man) 연동 (2026-07-23 협의 — "A안 먼저, B안 준비")

tc-man = TC 원장(마스터). Next.js+Prisma+Postgres, Snapshot/TestCaseExchange/coveragePercent/
automationStatus/isSmoke/TestProgramMapping 이 보드 개념과 1:1 대응. (github.com/iconloop/testcase_manager)

- **A안 (현행 유지)**: tc-man 스냅샷 → Sheets 내보내기 → 보드 생성에 URL 입력.
  한계: 스냅샷 export 시트에 Coverage %·자동화 상태 컬럼이 없어 부분 커버리지 자동 파생 불가
- **B안 구현 완료 (v0.17.0, 2026-07-23)**: 보드 생성 모달 = 소스 탭 3개(파일 기본 / Sheets / TC Manager).
  TC Manager 탭에서 스냅샷 선택 → 보드 이름·스냅샷(주기)·거래소 축 자동 채움(수정 가능) →
  서버가 tc-man 에서 TC 전량 fetch (lib/adapters/tcman.js) — coveragePercent·거래소 매핑 원본 유지
  - tc-man 측: **PR #4** (github.com/iconloop/testcase_manager/pull/4, myungjoo 브랜치) —
    `GET /api/export/snapshots(/:id)` read-only 2개 + `Bearer EXPORT_API_KEY` (미설정 시 503 비활성)
  - tr_ui 측: env `TCMAN_URL`/`TCMAN_API_KEY` (키는 서버만 보관), `/api/tcman/snapshots` 프록시
  - **운영 반영 조건**: PR #4 머지 + tc-man.rgrg.im 에 EXPORT_API_KEY 설정 + tr 운영 env 2개 추가
- DB 직결(C안)은 스키마 결합 때문에 배제 (로컬 검증용으로만)
- 역할 정리: tc-man = TC 원장·스냅샷 / tr_ui 보드 = 수행·실시간·이력·대시보드.
  결과 회신(tr_ui → tc-man TestResult write-back)은 추후 결정
- **2000 TC 스케일**: 그리드는 **Suite(시트) 접이식 섹션 완료 (v0.18.0)** — 3단(Suite > 대분류›중분류 > TC),
  섹션 헤더 진행률·Fail 요약, 200 TC 초과 기본 접힘. run 저장 data/runs/*.json 분리는 미착수(이벤트 누적 실측 후)

## 3-소스 발행 + 취합 권위 최종 (2026-07-23 사용자 확정, v0.18.0)

- 발행 = 자동 칸 → `automation` / 수동 칸 → `manual` (기입분만) / 최종 칸 → `test-run` (전량, N/T 포함)
  — 결과 대시보드에 소스 컬럼 3개·소스별 축·커버리지 표시 (기존 취합 어휘 재사용)
- consolidate 권위 규칙: **test-run 소스가 있으면 그 값이 pivot 최종** — 보드의 커버리지 인지 파생을
  D 규칙(불일치→Fail)이 덮어쓰지 않음. 타 소스 결정값 상이 시 mismatch 표시만 유지. 비 test-run 무회귀
- 자동 칸은 R2 리포터 유입부터 채워짐 — R2 후 재발행하면 automation 컬럼 자동 등장

## 동시성 — 수동 기입 중 자동화 유입 (2026-07-23 추가 협의)

**데이터 층**: 자동(auto)/수동(manual) 칸 분리(§확정 8)로 자동화↔테스터 충돌은 구조적으로 불가능
(서로 다른 필드에 씀) + append-only 이벤트라 덮임 없음. 유일한 경합 = 테스터 2명이 같은 셀 manual —
초기엔 last-write-wins + 이벤트 이력으로 충분, 인원 증가 시 셀 revision 낙관적 잠금(409) 추가.
서버는 node 단일 프로세스라 쓰기 직렬화, 셀 PATCH 는 요청당 원자적.

**화면 층 (침입 방지 4원칙)**:
1. 폴링 응답 = 변경 셀 목록(증분) → **해당 DOM 만 부분 패치**, 전체 재렌더·스크롤·포커스 이동 금지
2. **편집 중 셀은 갱신 보류** — 드롭다운 열림/메모 입력 포커스 셀의 원격 갱신은 큐잉 후 편집 종료 시 반영
3. 내 기입은 낙관적 반영(즉시 표시, 서버 확인은 백그라운드)
4. 원격 갱신은 조용한 신호 — 셀 하이라이트 플래시 + 🤖 배지, 알림창·강제 스크롤 없음

presence(셀 편집 중 표시)는 초기 범위 제외 — 실제 경합 관찰되면 revision 잠금과 함께 도입.

## 리스크·주의

- 동시 편집: 셀 단위 저장 + 마지막 저장 승리(이력이 메모에 남으므로 초기엔 충분). 편집 충돌 UI 는 후순위
- db.json 단일 파일 저장의 동시성 — 셀 PATCH 는 작은 트랜잭션이라 현 구조로 감당 가능하나,
  run 이 커지면(수천 TC × 거래소) 파일 분리(data/runs/*.json) 고려
- 리포터 인증: run별 uploadToken(보드에서 재발급 가능) — Google 세션과 무관해야 CI/로컬 어디서든 동작
- TC ID 태그 없는 자동화 테스트는 보드에 매칭 불가 — 미태그 리포트(기존 모달)와 동일하게 별도 카운트 노출
