# 결과 취합 기능 — 작업 핸드오프 (2026-07-21, 최종 갱신 2026-07-22)

> 다른 환경에서 이 문서만 읽고 바로 이어서 작업하기 위한 인수인계 문서.
> 대상: `tr_ui` (test-report-portal) · 브랜치 `feature/service-hub` · 2026-07-22 커밋 완료
> 설계 원본: [`RESULT_CONSOLIDATION_SPEC.md`](./RESULT_CONSOLIDATION_SPEC.md) (§ 참조는 이 스펙 기준)
> Phase 2 설계: [`RESULT_CONSOLIDATION_PHASE2_DESIGN.md`](./RESULT_CONSOLIDATION_PHASE2_DESIGN.md) (결정 3건 확정 포함)

## 2026-07-22 Phase 2 구현 완료 (v0.11.0)

설계: [`RESULT_CONSOLIDATION_PHASE2_DESIGN.md`](./RESULT_CONSOLIDATION_PHASE2_DESIGN.md) — D1~D4 전부 구현·검증 완료.

- **매뉴얼 어댑터** `lib/adapters/manual-sheet.js` — sheet-store(헤더 탐지·다단 헤더·반복 제거) + report-stats(결과 컬럼 감지) 조합. 시트 자동 채택(D2), TC당 대표값(D3), 플랫폼 유도(D4). XLSX/CSV(SheetJS)·GSheet URL 입력.
- **취합 코어 확장** — N/A 5번째 상태(D1: totalTc 모수 제외), envResults 보존·환경축(filterable:false), **거래소 조인**(거래소 없는 매뉴얼 레코드를 같은 TC의 모든 거래소 행에 조인 — 없으면 단독 행).
- **preview/commit 2단계 API** — `POST /consolidate/preview`(파싱·스테이징만, DB 무변화) → `POST /consolidate/commit`(확정). `DELETE /api/consolidate/staging/:id` 취소. 스테이징 TTL 24h(`db.staging`). Playwright 는 dirs 만 보관 후 커밋 시 재파싱. 프리픽스(플랫폼) 불일치 경고 포함.
- **업로드 위저드** — 소스 모달을 4단계(파일/양식→매핑 확인→미리보기→취합)로 교체, 결과형 업로드 진입점 단일화(리포트 업로드 버튼 재숨김). multer 취합 전용 인스턴스(zip/xlsx/xls/csv).
- **E2E 검증**: pw-report.zip(18소스·773행) + 파일 B 구조 XLSX → **불일치 2건 실검출**(양방향), N/A 모수 제외(774=775-1), 환경축, SCM- 프리픽스 경고, 취소 무변화, 데모 무회귀(773·73%). 테스트 68종 통과.
- ⚠ 미검증: 위저드 UI 브라우저 실조작, GSheet URL 입력(Google 세션 필요 — :3000 INTEGRATED 에서 확인).

## 2026-07-22 추가 작업 (v0.10.0)

- **거래소별 결과 통계** — AI Q&A 칩 → 차트 위젯(AI 미호출) + 📌 대시보드 고정(`project.pinnedWidgets`, `/api/projects/:id/widgets`)
- **업로드 공통 진입점(§11 1단계)** — 결과형에서 파일 업로드 탭도 Playwright ZIP 자동 감지·취합(`/reports` 라우트 분기), 통짜 ZIP(다중 리포트 폴더, 맥 상위 폴더 한 겹) 지원(`findPlaywrightDirs` 깊이 2), 업로드 상한 200MB→1GB + multer 에러 메시지화
- **문서형→결과형 전환** — Playwright 리포트 감지 배너 + `POST /api/projects/:id/convert-to-result` (기존 업로드 리포트를 소스로 인수, 재업로드 불필요). §9-7 '유형 편집 정책' 부분 결정: doc→result 단방향 전환만 지원
- **한글 IME 수정** — AI 질문 입력란 Enter 시 마지막 글자 잔류(`isComposing` 체크). ⚠ 같은 패턴 2곳 미수정: app.js `handleEditNameKey`, 전역 keydown(프로젝트 생성)
- **Phase 2 결정 3건 확정** — N/A 모수 제외 / 시트 자동 감지 / 매뉴얼 TC당 대표값 (설계 문서 §2)

---

## 0. 한 줄 요약

Playwright 자동화 리포트를 **TC ID 기준으로 취합**해 결과형 프로젝트의 **실시간 pivot 대시보드**로 보여주는 기능의 **수직 관통(Phase 0→3)** 을 구현·검증 완료. 자동화 단일 소스 기준으로 동작하며, 매뉴얼 소스 병합·불일치(Phase 2)는 미구현.

> ⚠ **필수 고려(§11)**: 현재 업로드 UX가 합의된 사용 시나리오(양식 선택 옵션 → 매핑 → 미리보기 → 취합)와 부합하지 않음. Phase 2 진행 시 §11을 반드시 먼저 읽을 것.

---

## 1. 배경 — 왜 이 작업을 했나

- QA팀 자동화 결과물 `QA_automation_results/2607_bingxbn/pw-report/` = **18개 Playwright HTML 리포트(591 테스트, 813MB)**.
- 이걸 tr-ui 결과 취합 기능에 넣으려 했으나, **Playwright 리포트는 데이터가 `<table>`이 아니라** `index.html`의 `<script id="playwrightReportBase64">`에 **zip(base64)로 임베드된 `report.json`**. → 스펙이 계획한 cheerio `<table>` 파싱(§7)으로는 결과 0건.
- 해결: 스펙의 어댑터 계층(§7)에 **Playwright 전용 어댑터**를 추가하고, 취합·pivot 코어와 서버 라우트·프론트까지 관통.

핵심 매핑:
- `test.title`의 `[SC-...]` = TC ID (병합 키). `[A | B]`(다중), `[A ~ D]`(범위) 분해 필요.
- `outcome`: expected→Pass, unexpected→Fail, skipped→N/T, flaky→Pass(flaky 플래그).
- 폴더명 `[Binance]`/`[BingX]` = 거래소 축.
- 첨부(webm/trace/png)는 **메타데이터만** 저장(813MB 미복제 — 사용자 확정).

---

## 2. 새 환경에서 이어받기 (Resume)

```bash
# 1) 코드 가져오기 (⚠ 현재 미커밋 — 아래 3-A 먼저 처리)
git clone <repo> tr_ui && cd tr_ui
git checkout feature/service-hub
npm install

# 2) 단위 테스트로 코어 동작 확인 (Docker 불필요)
npm test            # 전체 48 통과해야 정상 (어댑터 8 + 취합 12 + 기존 28)

# 3) Docker 없이 로컬 실행 (인증 우회)
npm run dev:local   # LOCAL_DEV=1 → Google 로그인 없이 http://localhost:3000

# 4) 데모 데이터 주입 (결과형 프로젝트 + 822 레코드)
#    ⚠ pw-report 원본 경로가 환경마다 다름 → 인자로 지정
node scripts/seed-demo.js /path/to/QA_automation_results/2607_bingxbn/pw-report
#    → '[데모] Playwright 자동화 취합' 프로젝트 생성. dev:local 재접속 시 대시보드 확인.
```

> **⚠ 원본 리포트 데이터**: `pw-report/`(813MB)는 별도 저장소 `QA_automation_results`에 있음. 새 환경에도 그 저장소가 있어야 seed·업로드 테스트 가능. seed 경로는 절대경로이며 머신마다 다름 → 반드시 인자/`PW_REPORT_ROOT` env로 지정.

---

## 3. 커밋/이관 체크리스트

### 3-A. 현재 미커밋 파일 (이 작업 산출물)

```
신규:
  lib/adapters/playwright.js      # Playwright 어댑터
  lib/consolidate.js              # TC ID pivot 병합·통계
  tests/playwright-adapter.test.js
  tests/consolidate.test.js
  scripts/seed-demo.js            # 데모 시드 (DB_FILE env 지원)
수정:
  server.js                       # project.type, sources/records, 라우트 4개, LOCAL_DEV
  public/index.html               # 유형 선택 모달, 취합 뷰 컨테이너, 소스 업로드 모달
  public/js/app.js                # 뷰 분기, renderConsolidated/renderConsTable, 소스 업로드
  public/css/style.css            # 취합 대시보드 스타일
  package.json                    # dev:local, seed:demo 스크립트
기존(이미 있던 설계 산출물, 미추적):
  docs/RESULT_CONSOLIDATION_SPEC.md, docs/qa-consolidation-*.{mermaid,html}
```

### 3-B. 이관 방법

```bash
git add -A
git commit -m "feat: 결과 취합 Phase 0~3 — Playwright 어댑터 + TC ID pivot 대시보드"
git push origin feature/service-hub
# → 새 노트북에서 pull 후 2절 진행
```
(⚠ `scripts/`는 `.gitignore` 대상 아닌지 확인 — 현재 추적 안 됨은 신규라서지 무시라서가 아님. `git status`에 `scripts/` 뜨면 정상.)

---

## 4. 구현 상세 (파일 지도)

### 4-1. `lib/adapters/playwright.js` — 어댑터
- `supports(input)` — dir/index.html/{html} 받아 Playwright 리포트인지 판별(base64 스크립트 or title).
- `parse(input, opts)` → `{ rows, detected }`. base64 추출→AdmZip unzip→`report.json` + `{fileId}.json` 파싱→정규화 레코드 배열.
  - opts: `{ exchange, snapshot, source }` (미지정 시 폴더명/기본값).
- `parseFolders(rootDir, opts)` — 하위 리포트 폴더 전부 파싱(seed·검증용).
- `parseTcIds(title)` — `[SC-...]` 추출, `|` 다중·`~` 범위 전개, 중복 제거. **테스트로 규칙 고정**.
- `mapOutcome(outcome)` — outcome→표준 결과값.
- 첨부: `path` 있는 것만(메타데이터), stdout 등 `body` 인라인은 제외.

### 4-2. `lib/consolidate.js` — 취합 코어 (순수 함수)
- `consolidate(records, {byExchange=true})` → `{ rows, stats, sources, untagged }`.
  - 행 키 = `tcId`(+거래소). 소스별 결과 pivot.
  - 한 소스 내 같은 TC 여러 결과 = **worst-wins**(Fail>Blocked>Pass>N/T).
  - 최종 상태: 결정값 없으면 N/T / 같으면 그 값 / 다르면 **불일치(mismatch)**·보수적 Fail / 하나면 그 값.
  - stats: `totalTc, byFinal, executed, passRate, mismatch, untagged, coverage{소스별%}`.
  - 정렬: 불일치 → Fail → tcId.

### 4-3. `server.js` — 라우트 (Phase 0·1·3)
- `project.type: 'result'|'doc'` (기본 `doc` → **레거시 무회귀**). `POST /api/projects`에서 수용.
- `loadDB()`가 `sources`/`records` 배열 없으면 초기화(레거시 DB 호환).
- 신규 라우트:
  - `POST /api/projects/:id/sources` ([server.js:721](../server.js#L721)) — ZIP 업로드→extractZip→어댑터 파싱→source+records 저장. 결과형만.
  - `GET  /api/projects/:id/sources` ([:787](../server.js#L787))
  - `DELETE /api/sources/:id` ([:794](../server.js#L794)) — 소스+파생 레코드+추출 파일 제거.
  - `GET  /api/projects/:id/consolidated` ([:806](../server.js#L806)) — records를 실시간 consolidate.
- `LOCAL_DEV=1` 인증 우회 (requireAuth 최상단, 기본 OFF). `INTEGRATED`와 독립.

### 4-4. 프론트 (`public/`)
- `index.html`: 새 프로젝트 모달 유형 선택(radio), projectView에 `#consolidatedView` + 결과형 액션 버튼(소스 업로드/새로고침), `#sourceModal` 소스 업로드 모달.
- `app.js`:
  - `createProject()` — type 전송.
  - `showProjectView(id)` — `project.type==='result'` 분기 → `renderConsolidated` vs 기존 `renderDateGroups`.
  - `renderConsolidated(id)` / `renderConsTable()` — 통계 카드 + 소스 목록 + 필터(전체/Fail/불일치/N/T)+검색 + pivot 표.
  - `openSourceModal/uploadSources/deleteSource`, `setupSourceZone()`(DOMContentLoaded에서 호출).
- `style.css`: `.cons-*`, `.res-badge`(res-Pass/Fail/NT), `.row-mismatch`, `.type-option` 등.

---

## 5. 데이터 모델 (정규화 레코드, §8.1)

`db.json`에 `sources[]`, `records[]` 추가:

```jsonc
// source (소스 파일 1건)
{ id, projectId, filename, format:'playwright', sourceRole:'automation',
  snapshot, exchange, folderId, indexPath, stats, rowCount, importedAt, importedBy }

// record (정규화 long — TC × 소스 × 거래소 하나의 결과)
{ id, sourceId, projectId, reportDirRel,
  tcId, source:'automation', result:'Pass|Fail|N/T', resultRaw, exchange, env,
  snapshot, reasonNote, durationMs, title, suite, flaky, untagged, coveredByMulti,
  attachments:[{name, contentType, path, exists}] }
```

데이터 흐름: `ZIP 업로드 → extractZip → pwAdapter.parse(dir) → records 저장 → GET consolidated → consolidate(records) → pivot`.

---

## 6. 검증 상태 (완료)

- **단위 테스트 44 통과** (`npm test`).
- 실데이터 18폴더: 원본 test stats(591/pass310/fail117/skip164) 일치, 정규화 822행.
- 취합 결과: **773 pivot 행, Pass율 73%(382/525), Fail 143, N/T 248, 자동화 커버리지 68%, 불일치 0**(단일 소스라 당연).
- 브라우저 렌더 확인: pivot 표(TC ID·거래소·automation·최종·사유), Fail 우선 정렬, 거래소축(`SC-TRD-LVRG-014`가 Binance/BingX 2행), 실제 Playwright 에러 사유 표시.
- **로컬 Docker 배포 검증**: tr-portal 재빌드·재기동, 데모 시드 병합(기존 14개 프로젝트 보존), http://localhost:3000 에서 확인 가능.

---

## 7. 함정 / 주의사항 (Gotchas)

1. **Dockerfile은 `scripts/` 미복사** → seed는 컨테이너 안에서 못 돌림. 호스트에서 `docker cp`로 볼륨 DB 꺼내 병합 후 재주입 (아래 8절).
2. **INTEGRATED=1**(로컬 Docker) → :3000 접근에 tcgen(:5001) SSO 로그인 필요. 빠른 확인은 `npm run dev:local`(LOCAL_DEV) 권장.
3. **DB는 named volume** `tr-portal-db`(→/app/data). 호스트 `data/db.json`과 별개. 컨테이너 재생성해도 볼륨은 유지.
4. `loadDB()`가 요청마다 파일을 새로 읽음 → 볼륨 DB 교체 시 즉시 반영.
5. **다중 TC 전개**로 test 수(591) ≠ 레코드 수(822) ≠ pivot 행(773). 정상. (1 test가 12 TC 커버 시 12행)
6. 첨부 원본 미복제 → seed 데이터의 `folderId=null` → 대시보드 "↗ 원본 열기" 미노출(대시보드 자체는 완전 동작).
7. `pw-report` 절대경로는 머신 종속 → seed에 반드시 경로 인자 전달.

---

## 8. 로컬 Docker 재배포 절차 (참고)

```bash
cd tr_ui
docker build -t test-report-portal .
# 기존 env(INTEGRATED, TCGEN_URL, TCGEN_PUBLIC_URL, ANTHROPIC_API_KEY) 재사용 후 재생성
docker rm -f tr-portal
docker run -d --name tr-portal --restart unless-stopped -p 3000:3000 \
  -v tr-portal-data:/app/uploads -v tr-portal-db:/app/data \
  --env-file <(docker inspect ... 또는 수동 env) test-report-portal
# 데모 시드를 볼륨 DB에 병합
docker cp tr-portal:/app/data/db.json /tmp/tr-db.json
DB_FILE=/tmp/tr-db.json node scripts/seed-demo.js /path/to/pw-report
docker cp /tmp/tr-db.json tr-portal:/app/data/db.json
```
> ⚠ `ANTHROPIC_API_KEY`가 컨테이너 env에 평문 존재(AI Q&A용). 로그/문서에 값 노출 금지.

---

## 9. 다음 할 일 (우선순위)

1. **[필수] 커밋·푸시** (3-B) — 이관 전 반드시.
2. **Phase 2 — 매뉴얼 소스 어댑터** (CSV/XLSX/GSheet) + 매핑·자동감지·미리보기. 그래야 매뉴얼 vs 자동화 **불일치**가 실제로 보임(스펙 수용기준 §13-4). 기존 `lib/report-stats.js`의 컬럼 감지 로직 재활용 가능. **⚠ 이때 업로드 UX를 §11의 공통 옵션 플로우로 재구성해야 함 — 매뉴얼 어댑터를 현재의 Playwright 전용 모달 옆에 또 하나의 전용 경로로 추가하면 안 됨.**
3. ~~**대시보드 재구성 (§11-2)**~~ — ✅ 완료 (2026-07-21). 게이지·축별 스택 바·Fail 사유 그룹핑·소스 목록 접기 구현, 테스트·브라우저 검증 완료.
4. **첨부 링크 UI** — record.attachments 메타는 이미 저장됨. 실제 업로드(ZIP) 소스는 `folderId` 있으니 `/uploads/{reportDirRel}/{path}`로 스크린샷·영상·trace 링크 노출.
5. **Phase 5 — 통합본 내보내기**(xlsx/gsheet, 스펙 §10).
6. **[선택] `/pdca analyze`** — RESULT_CONSOLIDATION_SPEC 수용기준(§13) 대비 gap 검증.
7. `project.type` 편집(문서형↔결과형)은 미지원 — 필요 시 정책 결정(스펙 §4는 "생성 시 고정").

---

## 10. 관련 파일 한눈에

| 파일 | 역할 |
|------|------|
| `docs/RESULT_CONSOLIDATION_SPEC.md` | 설계 원본(§ 참조 기준) |
| `docs/RESULT_CONSOLIDATION_HANDOFF.md` | (이 문서) |
| `lib/adapters/playwright.js` | Playwright→정규화 어댑터 |
| `lib/consolidate.js` | TC ID pivot 병합·통계 |
| `scripts/seed-demo.js` | 데모 시드 |
| `tests/playwright-adapter.test.js` / `tests/consolidate.test.js` | 단위 테스트 |
| `server.js` | 라우트·유형·LOCAL_DEV |
| `public/{index.html,js/app.js,css/style.css}` | 취합 대시보드 UI |

---

## 11. 필수 고려사항 — 사용 시나리오와의 정합성 (2026-07-21 피드백)

### 합의된 사용 시나리오 (스펙 §5–6.1, 목업 `qa-consolidation-upload-mockup.html`)

**결과 파일 양식이 소스마다 다르기 때문에**, 업로드 시 옵션을 제공해 사용자가 선택하고, 그 뒤 각 양식의 데이터 소스를 가지고 대시보드를 구성한다:

1. 업로드 → **양식/소스 유형 옵션 제공·선택** (자동 감지 + 사용자 확인)
2. 소스 레이아웃(분리형/단일형)·소스 태그·키 매핑 확인
3. **미리보기** (매칭 N · 미매칭 X · 불일치 통계)
4. 취합 실행 → 통합 대시보드

### 현재 구현(Phase 0~3)의 불일치

- `#sourceModal`(index.html)이 **Playwright ZIP 단일 양식으로 고정** — 양식 선택 옵션 자체가 없음.
- 취합 방식 카드(분리형/단일형)·파일별 소스 지정·키 매핑 확인 UI 미구현 (목업의 ① 단계 부재).
- **미리보기 단계 없이 업로드 즉시 커밋** (`POST /sources`에서 파싱→records 저장까지 한 번에). 스펙 §10의 `consolidate/preview` / `consolidate/commit` 분리 미반영.

즉 현재 구현은 "Playwright 리포트를 넣으면 바로 대시보드"라는 단축 경로이며, 합의된 "옵션 선택 → 매핑 → 미리보기 → 취합" 시나리오와 부합하지 않는다.

### 반영 방향 (Phase 2에서 필수)

- 업로드 모달을 **다단계 공통 플로우**로 재구성: ① 양식 선택(어댑터 `supports()` 자동 감지 + 확인) → ② 레이아웃/소스 태그/키 매핑 → ③ 미리보기(preview API) → ④ 취합 실행(commit).
- **Playwright도 이 플로우의 한 양식 선택지로 편입** — 전용 모달 유지 금지. (Playwright는 매핑이 자동이므로 ②를 요약 표시로 건너뛰는 건 허용, 단 진입점은 동일.)
- 서버는 즉시 커밋 대신 `preview`/`commit` 2단계 API(스펙 §10) 준수.
- 취합 코어(`lib/consolidate.js`)는 정규화 레코드 기준이라 **변경 불필요** — 업로드 측 수정 범위는 업로드 UX(`#sourceModal`)와 소스 등록 라우트(`POST /api/projects/:id/sources`)에 한정된다.

### 11-2. 대시보드 구성도 재작업 필요 (동일 피드백) — ✅ 구현 완료 (2026-07-21)

(구현됨) `renderConsolidated()`가 아래 ①~⑤ 구성으로 재작성됨. 서버는 `consolidate()` 반환에 `axes`(거래소/suite/소스별 집계)·`failReasons`(사유 패턴 상위 8) 추가 — `computeAxes`/`computeFailReasons`/`reasonPattern` (lib/consolidate.js). pivot 행에 `suite` 필드 추가(축 필터용). 축/사유 클릭 → pivot 필터 + 해제 칩. 불일치 필터 버튼·불일치/커버리지 카드·소스별 축은 **소스 2종 이상일 때만 노출**. 단위 테스트 4개 추가(총 48), 실데이터(822 레코드)·브라우저 렌더/인터랙션 검증 완료.

기존 문제: **숫자 카드 나열 + 소스 18행 전체 펼침 + 원시 pivot 표**로, 기존 단건 리포트 대시보드의 검증된 구성(우리 구성)과 다르고 너무 러프함. **스펙 §9.3(2026-07-21 개정)의 ①~⑤ 구성을 따를 것**:

| 순서 | 내용 | 재사용 대상 |
|------|------|-------------|
| ① 요약 밴드 | Pass Rate·실행률 **원형 게이지** + P/F/N-T 카운트. 불일치·커버리지 카드는 소스 2종 이상일 때만 | `renderDashboardPanel` 문법 (`.dash-rate-circle`, `.dash-counts`) |
| ② 축별 분포 | 거래소/영역(suite)/소스별 **누적 스택 바**, 클릭=pivot 필터 | `renderStackRow`, `renderDetailPanel` |
| ③ Fail 인사이트 | 사유 패턴 그룹핑 Top N (Timeout, toBeVisible…) + AI Fail 분석 연계 | `loadFailAnalysis` |
| ④ 소스 파일 | **접힌 요약 한 줄**로 강등 (현재 화면 절반 점유 문제) | — |
| ⑤ pivot 표 | 고정 높이 **스크롤 박스**(`.cons-table-wrap`) 안에 표시 | `renderConsTable` |
| ⑥ AI | Fail 분석(자동·지문 캐시) + Q&A(define_metric). 가상 id `cons-<projectId>`로 기존 UI 재사용, 서버는 통합 pivot→시트 형태 변환(`consolidatedAsSheetData`) 후 동일 파이프라인(`streamSheetChat`). 라우트: `POST /api/projects/:id/consolidated/chat`, `GET …/consolidated/fail-analysis`(캐시=`project.failAnalysis`) | `renderAiSection`, `loadFailAnalysis`, `sendAiQuestion` (+`aiEndpoint` 분기) |

주의: 축/사유 필터 클릭은 **부분 렌더**(`renderConsAxes`/`renderConsFilters`/`renderConsTable`)만 수행 — 전체 재렌더하면 AI 대화 DOM이 초기화됨. 취합 chat의 metric 배지는 📌 핀 버튼 미노출(핀은 리포트 스코프 API라서).

근거 데이터는 이미 records에 있음(`exchange`, `suite`, `reasonNote`) → 서버는 `consolidate()` 반환에 축별 집계·사유 그룹 추가, 프론트는 기존 dash-* 컴포넌트 재사용. 신규 데이터 수집 불필요.
