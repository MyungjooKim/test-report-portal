# tc-man export API 연동 — 확인 요청 (tr_ui → tc-man 팀)

> 2026-07-23 작성 / 2026-07-24 갱신.

## ✅ 진행 상황 (2026-07-24 최신) — 미들웨어 뚫림, EXPORT_API_KEY 만 남음

**어제(307 → /login)에서 오늘 크게 진전됨.** 지금 `tc-man.rgrg.im/api/export/snapshots` 를 호출하면:

```
HTTP 503  {"error":"EXPORT_API_KEY 미설정 — 내보내기 API가 비활성화되어 있습니다."}
```

- 307 리다이렉트가 사라짐 → **세션 미들웨어 예외가 반영되어 export 핸들러까지 요청이 도달함** ✅
- 남은 것은 **딱 하나: tc-man 서버에 `EXPORT_API_KEY` 환경변수 설정**. 설정되는 순간 200 + 스냅샷 목록이 오고, tr_ui 는 재배포 없이 자동 연동됨.
- (참고) 그 사이 순간적으로 브라우저에 **502(Cloudflare Bad gateway)** 가 보였는데, 이는 tc-man 오리진이 잠시 다운됐던 때(배포 중 추정). 지금은 503 으로 안정화. tr_ui 는 이 502/HTML 응답에도 화면이 깨지지 않도록 방어 코드 반영함(v0.19.4).

**→ tc-man 팀 To-Do: `EXPORT_API_KEY` 환경변수만 설정해 주세요.** (아래 상세는 히스토리)

---

> (히스토리) testcase_manager PR #4 (`/api/export/*` read-only) 머지 후,
> tr.rgrg.im 에서 `tc-man.rgrg.im` 의 export API 를 소비하려는데 **로그인 페이지로 리다이렉트**되어 연동 불가였음.

## ⭐ 유력 원인 — 서버 이전 시 미들웨어 인증 예외 설정 누락 (2026-07-24 확인)

tc-man 팀 확인 결과, export API 예외 처리는 **이전 서버에는 적용돼 있었으나 최근 서버 이전 과정에서 최신 서버(tc-man.rgrg.im)로 넘어오지 않은** 것으로 보입니다. 즉:

- **코드(PR #4)는 최신 서버에도 머지·배포되어 있음** — 그래서 재배포로도 증상이 안 바뀜
- **누락된 것은 "`/api/export/*` 를 세션 인증에서 제외하는 미들웨어 설정"** — 서버 이전 시 함께 반영되지 않음

### 대조군 — 로컬 tc-man 은 정상 (같은 tr_ui 코드로 즉시 연동됨)

로컬에서 실행 중인 tc-man(export API 예외가 살아있는 최신 코드)에 **동일한 tr_ui 코드·동일한 Bearer 인증**으로 붙였더니 바로 성공했습니다:

```
GET http://<local-tcman>/api/export/snapshots  (Authorization: Bearer <키>)
→ HTTP 200  {"ok":true,"snapshots":[
     {"version":"v.1.2","description":"For MOBILE","tcCount":169, ...},
     {"version":"v0.1-test","description":"Export 테스트용","tcCount":6, ...}
   ], ...}
```

→ **tr_ui 는 손댈 것이 없고**, 최신 서버에 미들웨어 예외 설정만 반영되면 로컬과 똑같이 즉시 연동됩니다.

## 증상 (재현)

tr_ui 서버가 다음과 같이 호출합니다 (스펙대로 `Authorization: Bearer <EXPORT_API_KEY>`):

```bash
curl -H "Authorization: Bearer <EXPORT_API_KEY>" \
     https://tc-man.rgrg.im/api/export/snapshots
```

**실제 응답 (재배포 후에도 동일):**

| 호출 | 결과 |
|---|---|
| GET `/api/export/snapshots` (Bearer 키 포함) | **HTTP 307 → `/login?callbackUrl=…`** |
| GET `/api/export/snapshots` (키 없이) | **동일하게 307 → `/login`** |
| 리다이렉트 최종 도착 | `<title>TC Manager</title>` 로그인 HTML 페이지 |

## 결정적 진단 — `/api/*` 전체가 로그인 미들웨어에 갇혀 있음

여러 경로를 찔러본 결과, **export 뿐 아니라 모든 `/api/*` 가 예외 없이 307 → /login** 입니다:

```
/api/export/snapshots   -> 307  /login?callbackUrl=%2Fapi%2Fexport%2Fsnapshots
/api/export             -> 307  /login?callbackUrl=%2Fapi%2Fexport
/api/export/health      -> 307  /login?callbackUrl=%2Fapi%2Fexport%2Fhealth
/api/health             -> 307  /login?callbackUrl=%2Fapi%2Fhealth
```

키 유무와 무관하게 동일 → **요청이 export 라우트 핸들러에 도달하기 전에 Next.js 세션 미들웨어가 먼저 가로채** 로그인으로 리다이렉트합니다.

→ **핸들러(PR #4 코드)가 아니라 미들웨어 matcher 설정 문제.** 그래서 재배포로도 안 고쳐졌습니다 — export 라우트가 세션 인증 matcher 에서 제외되어 있지 않음.

## 스펙상 기대 동작 (test-run.plan.md)

| 조건 | 기대 응답 |
|---|---|
| 키 유효 | `200 { ok: true, snapshots: [...] }` |
| `EXPORT_API_KEY` 미설정/비활성 | `503` |
| 키 불일치 | `401` |

→ 셋 중 어느 것도 아닌 **307 redirect** 가 오고 있어, 아직 배포/미들웨어 예외 처리가 안 된 것으로 판단됩니다.

## tc-man 팀에 확인 요청드릴 것 (우선순위 순)

1. **⭐ 이전 서버에 있던 "`/api/export/*` 세션 인증 예외" 설정을 최신 서버(tc-man.rgrg.im)에 반영**해 주세요.
   Next.js `middleware.ts` 의 `matcher` 에서 `/api/export/*` 를 제외하면 됩니다.
   현재 최신 서버는 `/api/*` 전체가 세션 인증으로 감싸여 있어, Bearer 인증 핸들러에 요청이 도달하지 못합니다.
   ```ts
   // 예: matcher 가 /api/export 를 negative lookahead 로 제외
   export const config = {
     matcher: ['/((?!api/export|_next|login).*)'],
   }
   ```
   또는 export route handler 내부에서 세션 검사를 건너뛰고 Bearer 만 검증하도록.
2. 위 반영 후, **`EXPORT_API_KEY` 환경변수가 최신 서버에도 설정**되어 있는지 (이전 서버 → 최신 서버 이전 시 함께 넘어왔는지 / 미설정 시 스펙상 503).
3. 확인용: 미들웨어 예외 반영 후 키 없이 `/api/export/snapshots` 호출 시 **307 이 아니라 401/503** 이 나오면 정상 진입한 것. (로컬 tc-man 은 이미 200 반환 — 위 대조군 참고)

## tr_ui 측 상태 (정상)

- `.env`: `TCMAN_URL=https://tc-man.rgrg.im`, `TCMAN_API_KEY=<발급키>` — 설정 완료
- 프록시 라우트 `/api/tcman/snapshots`, 어댑터 `lib/adapters/tcman.js` — 구현·테스트 통과 (129 tests green)
- tc-man 이 위 3개 확인 후 export API 가 200 을 반환하면 **추가 코드 변경 없이 즉시 연동**됩니다.

## 향후 논의 후보 (연동 성공 이후, 스냅샷이 쌓이면)

TR 보드 생성 시 스냅샷 목록을 프로젝트별 트리 + createdAt 최신순으로 정렬한다. 아래는 목록이
길어질 때 tc-man export 응답에 있으면 UX 가 크게 좋아지는 필드들 — 지금 당장은 불필요, 향후 논의.

1. **스냅샷 성격 플래그** (`status`: draft/released, 또는 `isTest`)
   - 사람이 `v2.0` 정식 배포 뒤 `v0.1-test` 같은 임시 스냅샷을 나중에 만들면, createdAt 최신순에서
     테스트본이 "최신" 자리를 차지함. 정렬 근거로 version 은 못 씀(사람이 지은 자유 문자열).
   - 성격 플래그가 있으면 released 만 상단 노출 / 테스트본은 접기 등 분리 가능.
2. **서버 페이징·검색** (`?project=&limit=&q=`)
   - 현재 tr_ui 는 전체 스냅샷을 한 번에 받아 클라이언트에서 필터. 전체 수천 개 규모가 되면
     이 전량 로딩이 느려짐. 그 시점엔 서버 페이징이 필요 — API 계약 변경 사항이라 미리 공유.
3. **createdAt 형식 보장** — tr_ui 는 `Date.parse` 로 방어(무효 시각은 목록 최하위)하지만,
   ISO 8601 형식이 일관되게 오는 게 정렬 신뢰의 전제.
