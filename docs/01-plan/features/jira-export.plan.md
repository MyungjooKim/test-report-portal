# Jira 등록 지원 — Fail 이슈 내보내기 (jira-export)

> 2026-07-23 사용자 협의로 확정. Jira 시스템 직접 연동은 **하지 않는다** — 테스터가 열람·확인 후
> 수동 등록할 수 있는 **등록용 문서**(Google Spreadsheet / XLSX)를 만들어 주는 기능.

## Executive Summary

| 항목 | 내용 |
|---|---|
| Feature | jira-export — Fail 이슈 Jira 등록용 내보내기 |
| 목적 | Fail TC를 체크 선택 → 거래소별 시트로 정리된 Jira 등록 문서 자동 생성 |
| 산출 | Google Spreadsheet 생성 + XLSX 다운로드 (둘 다) |
| 핵심 가치 | 테스터가 리포트를 일일이 옮겨 적던 Jira 등록 준비 작업을 클릭 몇 번으로 대체 |

## 확정 요구사항 (사용자 원문 8건 + 협의 3건)

1. Fail 행에 **체크박스** — 체크된 것만 내보내기
2. **전체 선택 / 전체 해제**
3. 그룹핑은 우선 **거래소별** (→ #8 시트 분리로 해결)
4. 열람은 web 이 아닌 **Google Spreadsheet 또는 CSV/Excel** — 테스터가 확인 후 Jira 수동 등록
5. 양식 = 예시 시트(1SZ0f5C2v58x_NaQoxx-qlX-P7VdW_StX7SPb_YkxBwg) 그대로
6. **Description 은 자동화 테스트 스크립트(리포트 데이터) 기반 자동 생성** — 예시를 규칙화
7. **JIRA / Link 컬럼은 빈 값** — 테스터 수동 기입용 형식만 제공
8. **시트는 거래소별 분리**
9. (협의) 산출 형식 = **둘 다** (XLSX 다운로드 + Google Spreadsheet 생성)
10. (협의) **매뉴얼 Fail 포함** — 매뉴얼 TC 문서에 사전조건·스텝·기대결과·중요도가 이미 있으므로 그 컬럼으로 Description 구성 (자동화보다 쉬움)
11. (협의) 스크린샷 컬럼 = **tr.rgrg.im 절대 URL** (클릭 열람)

## 산출 양식 (예시 시트 분석 결과)

컬럼: `No | Issue Type | 스위트 | Summary | Description | 스펙 파일:라인 | 스크린샷 파일 | JIRA | Link`

- No: 시트 내 자동 순번 / Issue Type: "Bug" 고정 / JIRA·Link: 빈 값
- 시트 1장 = 거래소 1개 (예: Binance, BingX)

### Description 생성 규칙 (예시 역공학 — [SC-SETT-002]로 1:1 재현 검증됨)

```
[Pre-condition]
테스트 화면: {스위트명} ({t.path 계층을 " / " 로 연결})
1. 웹사이트에 접속한다            ← Navigate to "/"
2. {메뉴} 메뉴를 클릭한다          ← 첫 gnb-*-link 클릭 (testid-ko 요소명에서 메뉴명 추출)

[Steps]
1. '{요소명}'을(를) 클릭한다        ← Click 스텝, testid-ko 사전으로 요소명 변환
2. '{요소명}'에 '{값}'(을)를 입력한다 ← Fill 스텝
(잔여 액션 0개면 → "(사전 조건 상태에서 화면을 그대로 확인)")

[Actual Result] / [Expected Result]
매처별 문장 틀 (error-humanize 확장):
- toBeVisible 타임아웃: "{n}ms 안에 화면에 나타나지 않았다." / "'{요소}' 요소가 {n}ms 안에 화면에 나타나야 한다."
- toHaveText/toContainText: "\"{실제}\"(으)로 표시되었다." / "'{요소}' 요소에 \"{기대}\" 문구가 표시되어야 한다."
- waitForEvent "page": "새 탭이 열리지 않았다." / "버튼 클릭 시 새 탭(팝업 창)이 열려야 한다."
- 값 비교: "값이 {실제}였다(조건 불만족)." / "값이 {조건} 이어야 한다."
- 미지 패턴: 에러 원문 첫 줄 폴백 (오역 없음 원칙)
```

- 데이터 소스: 레코드의 `reportDirRel`+`testId` 로 내보내기 시점에 원본 리포트의 임베드
  report.json 을 다시 열어 steps·location·attachments 추출 (검증 완료 — 데이터 전부 존재)
- 매뉴얼 Fail: 매뉴얼 시트의 사전조건/스텝/기대결과/중요도 컬럼을 그대로 Description 4단 틀에 배치
  - **주의**: 현 매뉴얼 어댑터는 이 컬럼들을 수집하지 않음 → 어댑터 확장 + 레코드 저장 필요
    (XLSX 업로드는 파싱 후 원본 삭제라 재조회 불가 — 커밋 시점 수집이 정석)

## 구현 단계

| 단계 | 내용 | 규모 |
|---|---|---|
| P1 | UI: Fail 표 체크박스 컬럼 + 전체/해제 + "Jira 등록용 내보내기" 버튼 | 소 |
| P2 | lib/jira-export.js: 리포트 재파싱 → Description 생성 엔진 (매처 문장 틀 + testid-ko) + 테스트 | 중 |
| P3 | 서버 export API: 선택 TC → 거래소별 그룹핑 → XLSX 생성(다운로드) | 소 |
| P4 | Google Spreadsheet 생성 (tcgen 통합 토큰 — scope `auth/spreadsheets` 확인 완료) | 소 |
| P5 | 매뉴얼 어댑터 확장: 사전조건/스텝/기대결과/중요도 컬럼 수집 → 매뉴얼 Fail Description | 중 |

P1~P4 = 자동화 Fail 대상 1차 완성. P5 = 매뉴얼 확장(신규 업로드부터 적용됨).

## 리스크·주의

- 예시 시트의 Pre-condition/[Steps] 경계는 QA 팀 수기 관행 — 규칙(진입 액션 vs 잔여 액션)이
  대부분 케이스와 일치함을 확인했으나, 실물 검증 후 경계 조정 여지 있음
- 재실행된 테스트: 마지막 result 기준 (기존 어댑터와 동일)
- 스크린샷 절대 URL 은 로그인 필요 링크 — 팀 내 사용 전제(외부 공유 시 접근 불가 안내)
