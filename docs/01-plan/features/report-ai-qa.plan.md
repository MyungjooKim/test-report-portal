# report-ai-qa Planning Document

> **Summary**: 개별 테스트 결과서에 스코프된 LLM Q&A 패널 + 검증된 인사이트를 대시보드 통계 카드로 승격(계산식 저장)
>
> **Project**: test-report-portal (TR Portal)
> **Version**: v0.3.1 기준
> **Author**: 김명주(Myungjoo Kim)
> **Date**: 2026-07-15
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 결과서 대시보드가 고정 통계(Pass Rate/실행률/Pass/Fail/N/T)만 제공해, "자동화상태=IMPLEMENTED 비율" 같은 세부 질문은 시트를 직접 열어 수작업으로 세어야 한다. |
| **Solution** | 결과서 하나를 컨텍스트로 물고 들어가는 Claude 기반 Q&A 패널. AI 는 답변과 함께 **계산 정의(필터+집계 JSON)** 를 생성하고 실제 숫자는 서버가 시트 데이터에서 결정적으로 계산. 사용자가 "대시보드에 추가"를 누르면 계산식이 저장되어 살아있는 통계 카드가 된다. |
| **Function/UX Effect** | 리포트 화면에서 자연어로 질문 → 스트리밍 답변 → 원클릭으로 커스텀 통계 카드 추가. 시트 새로고침 시 커스텀 카드도 기본 카드와 동일하게 자동 재계산. |
| **Core Value** | 정형화된 대시보드의 한계를 대화로 보완하고, 팀별로 중요한 지표를 스스로 발굴·고정할 수 있는 "확장 가능한 대시보드". 숫자 계산은 코드가 수행하므로 LLM 환각 없이 신뢰 가능. |

---

## 1. Overview

### 1.1 Purpose

Sheets 기반 테스트 결과서에서 사용자가 자연어 대화로 세부 데이터를 탐색하고, 검증된 지표를 대시보드의 영구 통계 카드로 승격할 수 있게 한다.

### 1.2 Background

- TR Portal 대시보드는 고정 5종 지표만 표시. 실제 QA 현장에서는 "자동화상태별 분포", "IMPLEMENTED 항목 중 Pass 비율", "특정 카테고리의 Fail 사유" 같은 애드혹 질문이 계속 발생.
- 회사는 이미 tcgen 에서 Anthropic Claude API 를 사용 중 — 동일 키/벤더로 확장 (2026-07-15 확정).
- 참고 모델: Google Sheets Gemini 사이드패널(스코프 Q&A), Metabase "질문을 카드로 저장"(계산식 승격).

### 1.3 확정된 결정 사항 (2026-07-15)

| # | 결정 | 내용 |
|---|------|------|
| 1 | 스코프 | 개별 결과서 단위 Q&A (Sheets 타입 우선), 프로젝트 전체 질의는 2차 |
| 2 | API 키 | tcgen 과 동일 `ANTHROPIC_API_KEY` 공유 |
| 3 | 대화 저장 | 대화는 휘발(세션 한정). 단 "대시보드에 추가" 시 **계산식(B안)** 저장 |
| 4 | 카드 범위 | 커스텀 카드는 해당 리포트에만 적용 |

---

## 2. Scope

### 2.1 In Scope (1차)

- [ ] 리포트 화면 내 AI Q&A 패널 (우측 슬라이드 or 대시보드 하단 확장)
- [ ] 백엔드 `POST /api/reports/:id/chat` — 리포트 시트 데이터 컨텍스트 + 질문 → Claude 스트리밍 응답
- [ ] Sheets 타입 리포트의 **원본 행 데이터(JSON) 보존** — 현재 HTML 로 변환 후 버려지는 시트 rows 를 저장 (계산식 평가와 LLM 컨텍스트의 공용 데이터 소스)
- [ ] AI 의 **계산 정의 생성** — 답변에 수치가 포함될 때 구조화된 metric JSON (필터 조건 + 집계 방식 + 라벨) 동봉, 숫자는 서버가 계산해 응답에 삽입
- [ ] "📌 대시보드에 추가" 버튼 — metric JSON 을 리포트에 저장(`report.customMetrics[]`)
- [ ] 대시보드 렌더링 시 customMetrics 를 시트 데이터로 재계산해 기본 카드 옆에 표시 (삭제 버튼 포함)
- [ ] 시트 새로고침(🔄) 시 커스텀 카드 자동 재계산
- [ ] 추천 질문 칩 (예: "상태별 분포", "Fail 원인 요약")
- [ ] 프롬프트 캐싱 — 같은 리포트 연속 질문 시 컨텍스트 부분 캐시 (~90% 절감)

### 2.2 Out of Scope (2차 이후)

- 프로젝트 범위 질의 (여러 결과서 비교, 회차 추이)
- HTML/zip/md 타입 리포트의 Q&A (텍스트 추출 정확도 검증 후)
- 대화 이력 영구 저장
- 커스텀 카드의 프로젝트 단위 템플릿화 (신규 리포트 자동 적용)
- 커스텀 카드 임계값 색상 규칙 (예: 90% 미만이면 빨강)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Sheets 리포트 가져오기/새로고침 시 원본 행 데이터를 JSON 으로 보존한다 | High | Pending |
| FR-02 | 리포트 화면에서 Q&A 패널을 열고 자연어 질문을 보낼 수 있다 | High | Pending |
| FR-03 | 답변은 스트리밍으로 표시된다 (긴 답변 대기 UX) | High | Pending |
| FR-04 | 수치성 질문에 대해 AI 는 계산 정의(metric JSON)를 생성하고, 숫자는 서버가 시트 데이터에서 계산한다 | High | Pending |
| FR-05 | 계산이 수행된 답변에는 "대시보드에 추가" 버튼이 표시된다 | High | Pending |
| FR-06 | 추가된 커스텀 카드는 기본 통계 카드와 같은 영역에 렌더링되고 삭제 가능하다 | High | Pending |
| FR-07 | 시트 새로고침 시 커스텀 카드가 새 데이터로 재계산된다 | High | Pending |
| FR-08 | 대화는 세션 휘발성이다 (서버 저장 없음, 패널 닫으면 초기화 허용) | Medium | Pending |
| FR-09 | 추천 질문 칩 3~4개를 패널 상단에 제공한다 | Medium | Pending |
| FR-10 | 계산 불가능한 질문(자유 요약 등)은 일반 텍스트 답변으로 처리한다 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 신뢰성 | 카드 수치는 100% 서버 계산 (LLM 생성 숫자를 카드에 저장하지 않음) | 코드 리뷰 + 단위 테스트 |
| 비용 | 같은 리포트 연속 질문 시 프롬프트 캐싱 적용 확인 | `usage.cache_read_input_tokens` > 0 |
| 성능 | 첫 토큰 표시 < 3초 (스트리밍) | 수동 확인 |
| 보안 | API 키는 서버 .env 전용, 클라이언트 미노출. 인증된 세션만 chat API 호출 가능 (기존 requireAuth) | 코드 리뷰 |
| 한도 | 질문 길이 제한 + 리포트 데이터가 컨텍스트 한도 초과 시 명시적 에러 (자동 절단 금지) | 단위 테스트 |

### 3.3 기술 스택 (확정)

| 항목 | 선택 | 근거 |
|------|------|------|
| LLM | Anthropic Claude API, `claude-opus-4-8` | 회사 표준 (tcgen 동일), 키 공유 |
| SDK | `@anthropic-ai/sdk` (TypeScript/JS) | Portal 이 Node.js/Express |
| 응답 방식 | Messages API 스트리밍 (SSE 로 프런트 전달) | 체감 속도 |
| 계산 정의 | Claude tool use (strict) 로 metric JSON 추출 → 서버 계산기 | 환각 차단 |
| 컨텍스트 | 시트 rows JSON 통째 전달 + `cache_control` | RAG 불필요 규모 |
| 데이터 저장 | 기존 `data/db.json` 확장 (`report.sheetData`, `report.customMetrics`) | 신규 인프라 없음 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 사용자 시나리오 통과: "IMPLEMENTED 비율?" → 답변 확인 → 카드 추가 → 새로고침 후 카드 갱신 확인
- [ ] FR-01~07 구현 및 동작 확인
- [ ] 계산기(metric evaluator) 단위 테스트 작성·통과
- [ ] 비통합 모드 회귀 없음 (기존 기능 영향 0)
- [ ] 운영 배포 (tr.rgrg.im)

### 4.2 Quality Criteria

- [ ] `node --check` 통과, 기존 테스트 통과
- [ ] LLM 응답 실패/타임아웃 시 사용자 친화적 에러 표시

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 시트 컬럼명이 리포트마다 달라 계산식이 안 맞음 | Medium | High | 계산식은 리포트 단위 저장(범위 확정 사항)이므로 해당 리포트 컬럼에만 바인딩. 컬럼 부재 시 카드에 "컬럼 없음" 표시 |
| 큰 시트(수천 행)로 컨텍스트/비용 증가 | Medium | Medium | 행 수 상한 + 컬럼 통계 요약 전달 옵션. 초과 시 명시적 안내 |
| LLM 이 잘못된 필터 정의 생성 | Medium | Medium | 계산 결과를 답변에 표시해 사용자가 검증 후 추가 (human-in-the-loop). 서버는 스키마 검증(strict tool use) |
| API 비용 증가 | Low | Medium | 프롬프트 캐싱 + 리포트당 질문은 사용자 명시 행동으로만 발생 |
| 기존 db.json 구조 변경으로 인한 회귀 | Medium | Low | 필드 추가만(하위호환), 마이그레이션 불필요 |

---

## 6. Architecture Considerations

### 6.1 구조 (기존 Portal 스택 유지 — 신규 프레임워크 없음)

```
[리포트 대시보드 (app.js)]
   ├─ 기본 통계 카드 (기존)
   ├─ 커스텀 통계 카드 ← report.customMetrics[] 를 서버 계산 API 로 렌더
   └─ AI Q&A 패널
        │ POST /api/reports/:id/chat (SSE 스트리밍)
        ▼
[server.js]
   ├─ report.sheetData (rows JSON) 로드
   ├─ Claude Messages API (스트리밍, tool use: define_metric)
   ├─ metric evaluator (필터+집계 계산기 — 순수 함수)
   └─ POST /api/reports/:id/metrics (카드 추가/삭제)
```

### 6.2 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| metric JSON 스키마 | `{label, filter: {col: value\|[values]}, agg: count\|ratio, of?: {col: value}}` | 단순하지만 사용자 예시(IMPLEMENTED 비율, IMPLEMENTED 중 Pass 비율) 커버. 설계 단계에서 확정 |
| 숫자 신뢰성 | LLM 은 식만, 계산은 evaluator | QA 도구 신뢰성 핵심 |
| 스트리밍 전달 | 서버가 Claude SSE 를 받아 클라이언트로 재스트리밍 | API 키 서버 은닉 |
| 시트 데이터 보존 | import/refresh 시 db.json 에 rows 저장 | 계산식 평가 + LLM 컨텍스트 공용 |

---

## 7. Convention Prerequisites

- 기존 Portal 컨벤션 유지: vanilla JS, 인라인 이벤트 핸들러, `api()` 헬퍼, 한국어 UI 문구
- 신규 환경변수: `ANTHROPIC_API_KEY` (서버 .env — tcgen 서버의 키 재사용)
- Anthropic SDK 의존성 추가: `@anthropic-ai/sdk` (package.json)

---

## 8. Next Steps

1. [ ] 설계 문서 작성 (`/pdca design report-ai-qa`) — metric 스키마, API 계약, 프롬프트, UI 목업 확정
2. [ ] 구현 (`/pdca do`)
3. [ ] 갭 분석 (`/pdca analyze`) → 배포

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-15 | 초안 — 사용자 확정 결정 4건 반영 | 김명주(Myungjoo Kim) |
