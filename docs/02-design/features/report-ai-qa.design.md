# report-ai-qa Design Document

> **Summary**: 리포트 스코프 AI Q&A 패널 + 계산식 기반 커스텀 통계 카드의 기술 설계
>
> **Project**: test-report-portal (TR Portal)
> **Version**: v0.3.1 기준
> **Author**: 김명주(Myungjoo Kim)
> **Date**: 2026-07-15
> **Status**: Draft
> **Planning Doc**: [report-ai-qa.plan.md](../../01-plan/features/report-ai-qa.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 기존 Portal 구조(vanilla JS + Express + db.json)에 **외과적으로** 얹는다 — 신규 프레임워크/DB 없음
- 카드에 표시되는 모든 숫자는 서버의 결정적 계산기(metric evaluator)가 생성 — LLM 은 계산식만 만든다
- 시트 새로고침 시 커스텀 카드가 기본 카드와 동일한 lifecycle 로 재계산된다

### 1.2 Design Principles

- **환각 차단**: LLM 답변 속 수치도 evaluator 계산값을 삽입 (strict tool use)
- **휘발 대화, 영속 계산식**: 대화는 브라우저 메모리만, 저장되는 것은 metric 정의 뿐
- **데이터 분리**: 시트 원본은 리포트별 파일로 — db.json (매 요청 전체 로드) 비대화 방지

---

## 2. Architecture

### 2.1 Component Diagram

```
[브라우저 app.js]
  ├─ 대시보드 패널 (기존 renderDashboardPanel)
  │    └─ + 커스텀 지표 카드 영역  ← GET /api/reports/:id/metrics (계산된 값)
  │         └─ 카드 삭제 ✕        → DELETE /api/reports/:id/metrics/:mid
  └─ AI 질문 패널 (dash-panel 하단 접이식 섹션)
       ├─ 추천 질문 칩 + 입력창
       ├─ POST /api/reports/:id/chat  (fetch + ReadableStream, SSE 형식)
       └─ 답변 내 metric 결과 → "📌 대시보드에 추가" → POST /api/reports/:id/metrics

[server.js]
  ├─ sheetStore  : data/sheets/{reportId}.json 읽기/쓰기/삭제
  ├─ metricEval  : evaluateMetric(sheetData, def) — 순수 함수
  ├─ chat 핸들러 : Claude Messages API 스트리밍 + define_metric tool 루프
  └─ metrics CRUD: report.customMetrics[] (db.json)

[Anthropic API]  claude-opus-4-8, 시트 JSON 은 cache_control 로 캐싱
```

### 2.2 데이터 흐름 (시트 → 카드)

```
gsheet import/refresh
  → allData(시트별 rows) 를 data/sheets/{id}.json 저장  ← FR-01 (신규)
  → 기존 HTML 생성/통계는 그대로
대시보드 열기
  → GET /metrics: customMetrics[] 를 sheetData 로 각각 evaluate → 계산값 반환
새로고침(🔄)
  → sheetData 갱신 → 다음 GET /metrics 부터 새 값 (프런트는 대시보드 재로드)
리포트 삭제
  → data/sheets/{id}.json 도 삭제
```

---

## 3. Data Design

### 3.1 시트 원본 저장 — `data/sheets/{reportId}.json`

```json
{
  "savedAt": "2026-07-15T05:00:00Z",
  "sheets": [
    { "name": "TC 목록",
      "header": ["ID", "분류", "시나리오", "자동화상태", "결과"],
      "rows": [["TC-001", "로그인", "...", "IMPLEMENTED", "PASS"], ...] }
  ]
}
```

- 첫 행 = header 로 간주 (generateSheetHtml 과 동일 가정)
- **상한**: 시트 합계 5,000 행 또는 파일 1MB 초과 시 저장하되 chat 컨텍스트에는 행 수 제한 적용(§6.2)
- gsheet 타입 외 리포트는 sheetData 없음 → AI 패널 비노출

### 3.2 커스텀 metric 정의 — `report.customMetrics[]` (db.json)

```json
{
  "id": "uuid",
  "label": "IMPLEMENTED 중 Pass 비율",
  "sheet": null,                     // null = 전체 시트 합산, 또는 시트명
  "filter": [ {"col": "자동화상태", "op": "eq", "value": "IMPLEMENTED"} ],
  "agg": "ratio",                    // "count" | "ratio"
  "of":     [ {"col": "결과", "op": "eq", "value": "PASS"} ],   // agg=ratio 일 때 필수
  "createdBy": "김명주(Myungjoo Kim)",
  "createdAt": "2026-07-15T05:10:00Z"
}
```

**연산 정의**
- `count`: filter 를 모두 만족하는 행 수. 표시: `N건 (전체 M건 중, P%)`
- `ratio`: 분모 = filter 만족 행, 분자 = filter ∧ of 만족 행. 표시: `P% (분자/분모)`
- 조건 `op`: `eq`(대소문자 무시 완전일치) | `in`(값 배열) | `contains`(부분일치) | `not_empty`
- filter 가 빈 배열이면 전체 행이 분모 (예: "IMPLEMENTED 비율" = filter:[] + agg:ratio + of:[자동화상태=IMPLEMENTED])

**evaluator 실패 처리**: 컬럼명이 header 에 없으면 `{error: "컬럼 없음: 자동화상태"}` — 카드에 ⚠️ 표시 (새로고침으로 컬럼이 사라진 경우 대비)

---

## 4. API Design

### 4.1 `POST /api/reports/:id/chat` — Q&A (SSE 스트리밍)

Request: `{ "messages": [{"role":"user","content":"IMPLEMENTED 비율은?"}, ...] }`
- 대화 이력은 클라이언트가 보냄 (서버 무상태). 최근 10 메시지로 절단, 질문당 1,000자 제한

Response (`text/event-stream`):
```
event: text     data: {"delta": "자동화상태가 IMPLEMENTED 인 항목은 "}
event: metric   data: {"definition": {...}, "computed": {"value": "76%", "numerator": 62, "denominator": 81}}
event: text     data: {"delta": "62건으로 전체의 76% 입니다."}
event: done     data: {}
event: error    data: {"message": "..."}
```
- `metric` 이벤트가 있으면 프런트는 해당 답변 말미에 "📌 대시보드에 추가" 버튼 렌더 (definition 을 버튼에 보관)
- 실패 조건: sheetData 없음(400), LLM 오류(502), 인증(기존 requireAuth 401)

### 4.2 metrics CRUD

| Method | Path | 동작 |
|--------|------|------|
| GET | `/api/reports/:id/metrics` | customMetrics 각각 evaluate 하여 `[{id,label,display,error?}]` 반환 |
| POST | `/api/reports/:id/metrics` | body = definition. 서버에서 evaluate 검증 후 저장 (실패 시 400). 리포트당 최대 8개 |
| DELETE | `/api/reports/:id/metrics/:mid` | 카드 삭제 |

### 4.3 기존 API 변경

- gsheet import(`/api/google/sheets/import`)·refresh(`/api/reports/:id/refresh`): allData 를 sheetStore 에 저장하는 1줄 추가
- report 삭제 핸들러: sheet 파일 삭제 추가

---

## 5. LLM Integration Design

### 5.1 호출 구성

- SDK: `@anthropic-ai/sdk`, 모델 `claude-opus-4-8`, `client.messages.stream()`
- `max_tokens: 4096`, `thinking: {type: "adaptive"}` (기본)
- **시스템 프롬프트 구조** (캐싱 최적화 — 안정 내용 먼저):
```
[블록1] 역할·규칙 (고정 텍스트)
[블록2] 리포트 컨텍스트: 리포트명, 시트별 header + rows JSON   ← cache_control: ephemeral
(질문은 messages 로 — 캐시 브레이크포인트 뒤)
```
- 규칙 핵심: "수량/비율 질문에는 반드시 define_metric 도구를 사용하라. 숫자를 직접 세지 마라. 도구 결과의 값을 인용해 한국어로 답하라. 자유 서술 질문(요약·원인분석)은 도구 없이 답한다."

### 5.2 `define_metric` 도구 (strict)

```json
{
  "name": "define_metric",
  "strict": true,
  "description": "시트 데이터에 대한 수치 계산 정의. 수량/비율 질문이면 반드시 사용.",
  "input_schema": {
    "type": "object",
    "properties": {
      "label": {"type": "string"},
      "sheet": {"type": ["string", "null"]},
      "filter": {"type": "array", "items": { ...조건 스키마(§3.2)... }},
      "agg": {"type": "string", "enum": ["count", "ratio"]},
      "of": {"type": "array", "items": { ...조건 스키마... }}
    },
    "required": ["label", "sheet", "filter", "agg", "of"],
    "additionalProperties": false
  }
}
```

### 5.3 서버측 도구 루프 (수동, 최대 3회)

```
stream 시작 → text delta 는 즉시 SSE 로 전달
stop_reason == "tool_use" (define_metric):
  ① evaluateMetric() 실행
  ② SSE `metric` 이벤트 전송 (definition + computed)
  ③ tool_result 로 계산값 반환 → 다음 stream 계속
stop_reason == "end_turn" → done
```

- 한 답변에 metric 여러 개 가능 (예: "상태별 분포" → 상태 수만큼) — 각각 `metric` 이벤트, 각각 📌 가능

### 5.4 컨텍스트 상한

- rows 를 컨텍스트에 넣을 때 시트당 최대 1,500행 / 전체 직렬화 300KB. 초과 시: 헤더 + 컬럼별 고유값 상위 50개 + 행 수만 전달하고, 답변에 "전체 행 미포함(요약 모드)" 명시. evaluator 는 항상 전체 데이터로 계산하므로 카드 정확성엔 영향 없음

---

## 6. UI Design

### 6.1 대시보드 패널 확장 (renderDashboardPanel)

```
[Pass Rate ◯] [실행률 ◯] [Pass][Fail][N/T][Total]   ← 기존
─ 커스텀 지표 ──────────────────────────────
[📌 IMPLEMENTED 중 Pass  94% (59/63)  ✕]  [📌 ...  ✕]   ← dash-custom 카드
─────────────────────────────────────────
[🤖 AI 에게 질문 ▾]                      ← gsheet 타입만 표시
  ├ 칩: [상태별 분포] [Fail 원인 요약] [실행 안 된 항목]
  ├ (대화 말풍선 영역 — 세로 스크롤, 최대 높이 400px)
  │   AI 답변 내 계산 결과: [ 76% (62/81) · IMPLEMENTED 비율 ] [📌 대시보드에 추가]
  └ [질문 입력............................] [전송]
```

- 커스텀 카드는 `dash-count` 와 유사한 스타일의 가로 카드 + label + 삭제 버튼(✕)
- **삭제는 AI 로 추가된 커스텀 카드에만 존재** — 기본 통계 카드(Pass Rate/실행률/카운트)는 삭제 UI 없음
- ✕ 클릭 시 `confirm("'{label}' 카드를 삭제할까요?")` 확인 후 DELETE 호출 (실수 방지)
- 카드 error 시: `⚠️ 컬럼 없음` 표시 (삭제 가능)
- 대화 상태는 JS 메모리 (`chatState[reportId]`) — 패널 접었다 펴도 유지, 페이지 이탈 시 소멸 (FR-08)
- 📌 클릭 → POST 성공 → 커스텀 지표 영역 즉시 갱신 + 버튼 "✅ 추가됨" 비활성화

### 6.2 스트리밍 처리 (프런트)

- `fetch()` + `response.body.getReader()` 로 SSE 파싱 (EventSource 는 POST 불가)
- text delta 는 마지막 말풍선에 append, metric 이벤트는 결과 배지 + 📌 버튼 삽입
- 답변 텍스트는 `escapeHtml` 적용 (XSS 방지) — 마크다운 렌더링은 줄바꿈만 처리 (1차)

---

## 7. Error Handling

| 상황 | 처리 |
|------|------|
| ANTHROPIC_API_KEY 미설정 | chat API 503 + "AI 기능이 설정되지 않았습니다" (패널은 비노출 — /api/config 에 aiEnabled 추가) |
| sheetData 없는 구버전 리포트 | 패널에 "🔄 새로고침하면 AI 질문을 사용할 수 있습니다" 안내 |
| Claude 429/529/타임아웃 | SSE error 이벤트 → 말풍선에 재시도 버튼 |
| strict 도구 입력이 evaluator 검증 실패 | tool_result 에 is_error 로 사유 반환 → 모델이 재시도 (루프 3회 내) |
| metric POST 중복 label | 허용 (사용자 책임), id 는 항상 신규 |

---

## 8. Implementation Order

1. **sheetStore + FR-01**: import/refresh 시 rows 저장, 삭제 연동 (기존 기능 회귀 없음 확인)
2. **metricEval**: 순수 함수 + 단위 테스트 (`node --test tests/metric-eval.test.js`)
3. **metrics CRUD API** + 대시보드 커스텀 카드 렌더링 (LLM 없이 수동 POST 로 검증 가능)
4. **chat API**: Anthropic SDK 도입, 도구 루프 + SSE
5. **AI 패널 UI**: 칩/말풍선/스트리밍/📌
6. **엔드투엔드 검증**: 계획서 §4.1 시나리오 (IMPLEMENTED 비율 → 카드 추가 → 새로고침 갱신)

- 신규 의존성: `@anthropic-ai/sdk` 1개
- 신규 env: `ANTHROPIC_API_KEY` (서버 .env — tcgen 키 재사용)
- 예상 규모: server.js +300줄 내외, app.js +250줄, css +80줄, 테스트 1파일

---

## 9. Test Plan

| 대상 | 방법 |
|------|------|
| metricEval | 단위 테스트: eq/in/contains/not_empty, count/ratio, 시트 지정/전체, 컬럼 없음 에러, 대소문자 무시 |
| sheetStore | 단위 테스트: 저장/로드/삭제, 상한 처리 |
| chat API | 수동: 실제 시트로 3개 시나리오 (수치 질문 / 자유 요약 / 계산 불가 질문) |
| 회귀 | 기존 gsheet import/refresh/stats 동작 불변, 비 gsheet 리포트에서 패널 미노출 |
| E2E | 계획서 Definition of Done 시나리오 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-15 | 초안 — metric 스키마·API 계약·도구 루프·UI 확정 | 김명주(Myungjoo Kim) |
