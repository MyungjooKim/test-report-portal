# report-ai-qa Gap Analysis

> **Date**: 2026-07-15 · **Analyzer**: bkit gap-detector
> **Design**: [report-ai-qa.design.md](../02-design/features/report-ai-qa.design.md)

## Overall

| Category | Score |
|----------|:-----:|
| Design Match (§3~§7) | 96% |
| Plan Requirements (FR-01~10) | 100% |
| **Overall Match Rate** | **97%** ✅ |

- 누락 기능 없음. FR-01~FR-10 전부 구현. 단위 테스트 8종 + 사용자 E2E 통과 (질문→계산 배지→📌→대시보드 카드→새로고침 갱신).
- 배포 가능 판정 (Definition of Done 충족).

## Gaps (전부 Low)

| ID | 내용 | 판정 |
|----|------|------|
| G-1 | sheet-store 저장측 상한(5,000행/1MB) 미적용 — LLM 컨텍스트 상한(§5.4)만 적용 | 의도적 동등 구현 (카드 정확성 위해 evaluator 는 전체 데이터 필요). 설계 문서 갱신 권고 |
| G-2 | count 표시 문구 `N건 / 전체 M건 (P%)` — 설계와 조사 하나 차이 | 코스메틱 |
| G-3 | LLM 오류 시 HTTP 502 대신 SSE error 이벤트 | 스트림 개시 후 상태코드 변경 불가 — 구현이 옳음. 설계 갱신 권고 |
| G-4 | 구버전 리포트 패널 내 "새로고침" 배너 없음 (400 에러 메시지로 안내됨) | UX 폴리시 후보 |
| G-5 | 오류 말풍선에 명시적 "재시도" 버튼 없음 (실패 질문은 이력에서 제거되어 재전송 가능) | UX 폴리시 후보 |
| T-1 | sheetStore 단위 테스트 없음 (§9 계획 대비) | 후속 추가 권고 |

## 설계에 없던 개선 (긍정)

- sheet-store reportId 경로 조작 방어 (`path.basename`)
- metric label 길이 검증 (1~80자)
- evaluator 완전 빈 행 제외

## 후속 조치

- 즉시: 없음 (배포 진행)
- 후속: G-4/G-5 UX 폴리시, T-1 sheetStore 테스트, 설계 문서 동기화(G-1/G-2/G-3)
