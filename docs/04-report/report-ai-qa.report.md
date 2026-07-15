# report-ai-qa Completion Report

> **Project**: test-report-portal (TR Portal) · **Version**: v0.4.0
> **Author**: 김명주(Myungjoo Kim) · **Date**: 2026-07-15 · **Status**: Completed (운영 배포)

---

## Executive Summary

| 항목 | 내용 |
|------|------|
| Feature | report-ai-qa — 리포트 스코프 AI Q&A + 계산식 기반 커스텀 통계 카드 |
| 기간 | 2026-07-15 (Plan → 운영 배포, 1일) |
| Match Rate | **97%** (요구사항 FR-01~10 = 10/10) |
| 산출물 | 신규 모듈 2개(lib/) + 테스트 8종, server.js/app.js/css 확장, 문서 4종(plan/design/analysis/report) |
| 배포 | tr.rgrg.im v0.4.0 (main@d30a270), 서버 .env 에 ANTHROPIC_API_KEY 주입 |

### Value Delivered

| Perspective | Delivered |
|-------------|-----------|
| **Problem** | 대시보드가 고정 5종 통계만 제공 — "IMPLEMENTED 비율" 같은 세부 지표는 시트를 열어 수작업 집계해야 했음 |
| **Solution** | 결과서 하나를 컨텍스트로 무는 Claude Q&A + `define_metric` strict tool → 서버 계산기(metric-eval). 검증된 지표는 📌 원클릭으로 대시보드 카드 승격 |
| **Function/UX Effect** | 자연어 질문 → 스트리밍 답변 → 카드 추가 → 시트 새로고침 시 자동 재계산. 실사용 검증: "IMPLEMENTED 중 Pass 비율 73% (81/111)" 카드 E2E 통과 |
| **Core Value** | 팀이 스스로 지표를 발굴·고정하는 **확장 가능한 대시보드**. 숫자는 100% 코드 계산(LLM 환각 차단) — QA 도구로서의 신뢰성 유지 |

---

## 1. PDCA 사이클 요약

| Phase | 산출물 | 결과 |
|-------|--------|------|
| Plan | [plan.md](../01-plan/features/report-ai-qa.plan.md) | 사용자 확정 결정 4건(스코프/키 공유/계산식 저장/리포트 범위) 반영 |
| Design | [design.md](../02-design/features/report-ai-qa.design.md) | metric 스키마, SSE 계약, 도구 루프, UI 확정. 갭 분석 후 G-1~G-3 동기화 완료 |
| Do | 커밋 3건 (feat + Dockerfile fix + release) | 6단계 구현: sheetStore → metricEval(+테스트) → CRUD → chat → UI → E2E |
| Check | [analysis.md](../03-analysis/report-ai-qa.analysis.md) | Match Rate 97%, 누락 0, 갭 전부 Low |
| Act | — | 90% 이상 → iterate 불필요 |

## 2. 구현 하이라이트

- **환각 차단 아키텍처**: LLM 은 계산식만 생성(strict tool), 숫자는 `lib/metric-eval` 순수 함수가 결정적으로 계산. 대화 단계에서 사용자가 값을 검증한 뒤에만 카드로 승격 (human-in-the-loop)
- **살아있는 카드**: 저장 대상이 스냅샷이 아닌 계산식 — 시트 새로고침 시 기본 카드와 동일 lifecycle 로 재계산. 컬럼이 사라지면 ⚠️ 표시
- **비용/성능**: 시트 컨텍스트 프롬프트 캐싱(연속 질문 ~90% 절감), 대형 시트 요약 모드(계산은 항상 전체 데이터)
- **회귀 0**: `ANTHROPIC_API_KEY` 미설정 시 기능 자체 비노출, 비 gsheet 리포트 영향 없음

## 3. 발견·수정된 이슈

| 이슈 | 처리 |
|------|------|
| Dockerfile 이 `lib/` 미복사 → 컨테이너 기동 실패 | COPY 추가 (로컬 E2E 준비 중 발견) |
| 로컬 tcgen 이 v0.18.5 라 `/whoami/token` 부재 → Sheets 가져오기 실패 | 로컬 tcgen 재빌드로 해소 (환경 이슈, 코드 무관) |

## 4. 후속 과제 (Low, 선택)

- G-4: 구버전 리포트 패널 내 "새로고침" 안내 배너
- G-5: 오류 말풍선 "재시도" 버튼
- T-1: sheetStore 단위 테스트
- 2차: 프로젝트 범위 질의(회차 비교), HTML/zip 리포트 Q&A, 카드 프로젝트 템플릿화

## 5. 배운 것

- **"계산식 저장" 패턴**: LLM 이 만드는 것과 코드가 계산하는 것을 분리하면 신뢰성과 유연성을 동시에 얻는다 — 이후 AI 기능 설계의 기본형
- dotenv 기반 키는 `docker exec` 단독 환경조회로는 안 보임 — 검증은 앱 프로세스 기준으로
