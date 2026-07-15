# TR Portal

테스트 결과 리포트를 팀원과 함께 관리하고 열람할 수 있는 웹 포털.

## 주요 기능

- **리포트 업로드** — HTML, ZIP(폴더), Markdown, Google Spreadsheet 지원
- **프로젝트 트리 구조** — 최대 3 depth 계층 폴더, 드래그앤드롭 순서 변경
- **Google Sheets 연동** — URL/ID로 가져오기, 새로고침으로 최신 데이터 반영
- **리포트 대시보드** — Pass Rate, 실행률, 시트별 통계, Fail 목록 자동 생성
- **🤖 리포트 AI Q&A** (v0.4.0) — Sheets 리포트에 자연어로 질문 (Claude, 스트리밍).
  수치 질문은 AI 가 계산 정의를 만들고 **서버가 계산**해 답하므로 환각 없음
- **📌 커스텀 통계 카드** (v0.4.0) — AI 답변의 계산 결과를 대시보드에 고정.
  저장되는 것은 숫자가 아니라 **계산식**이라 시트 새로고침 시 자동 재계산
- **QA 통합 SSO** (v0.3.0) — `INTEGRATED=1` 이면 TC Generator 로그인 하나로 사용,
  우상단 9-dot 런처로 도구 전환, 로그아웃도 양쪽 동시
- **검색** — 파일명, 헤딩, 테이블 내용 기반 키워드 검색 + 프로젝트 스코프 필터
- **Google OAuth 로그인** — 포털 전체 인증, 비공개 프로젝트 지원
- **브라우저 네비게이션** — 뒤로가기/앞으로가기, URL 공유 가능
- **Markdown 뷰어** — .md 파일을 렌더링된 HTML로 표시
- **사이드바 리사이즈** — 드래그로 폭 조절 (더블클릭 초기화)

## 기술 스택

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + CSS (프레임워크 없음)
- **Storage**: JSON 파일 DB + 파일 시스템
- **Auth**: Google OAuth 2.0
- **Deploy**: Docker

## 로컬 실행

```bash
npm install
cp .env.example .env  # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 설정
npm start
# → http://localhost:3000
```

### Docker로 실행

```bash
docker build -t test-report-portal .
docker run -d --name tr-portal -p 3000:3000 \
  -v tr-portal-data:/app/uploads \
  -v tr-portal-db:/app/data \
  test-report-portal
```

## 환경변수 (.env)

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# QA 통합 모드 (선택) — 설정 시 자체 로그인 대신 TC Generator 세션을 신뢰 (SSO)
# 미설정 시 기존 자체 Google 로그인 그대로 동작
INTEGRATED=1
TCGEN_URL=http://localhost:5001          # 서버 대 서버 검증용 (Docker: http://host.docker.internal:5001)
TCGEN_PUBLIC_URL=http://localhost:5001   # 브라우저 리다이렉트용 (미설정 시 TCGEN_URL, 운영: https://tc.rgrg.im)

# 리포트 AI Q&A (선택) — 미설정 시 AI 기능이 UI 에 노출되지 않음
# tcgen 과 같은 Anthropic API 키를 공유한다
ANTHROPIC_API_KEY=sk-ant-...
```

## 테스트

```bash
npm test   # lib/metric-eval 계산기 단위 테스트 (node --test)
```

### QA 통합 모드 (INTEGRATED=1)

- 로그인은 TC Generator 로 위임 (`/login` → tcgen `/login`), 자체 `/auth/google` 은 비공개
- 세션 검증: 브라우저 쿠키를 tcgen `/whoami` 로 서버 대 서버 포워딩, 검증 후 세션 캐시 (5분마다 재확인 — tcgen 로그아웃 전파)
- 우상단 9-dot 런처로 TC Generator ↔ TR Portal 전환 (`/api/config` 로 통합 여부 전달)
- `/logout`: 포털 세션 파기 → tcgen `/logout` 연쇄 리다이렉트로 양쪽 세션 모두 종료

## 브랜치 전략

```
main     ← 배포 버전 (태그, 서버 반영)
develop  ← 개발 통합 (PR 머지 대상)
feature/ ← 개별 작업 브랜치
```

### 워크플로우

| 명령 | 역할 |
|------|------|
| `./ship.sh "메시지"` | 커밋 → push → develop 머지 |
| `./pull.sh` | 부모 브랜치 최신 내용 받기 |
| `./deploy.sh "메시지"` | develop → main → 서버 배포 |

## 서버 배포

```bash
./deploy.sh "feat: 새 기능"
# → develop→main 머지 → 서버 git reset --hard → docker build → 헬스체크
```

서버: `http://131.186.17.216:6000` (도메인 연결 예정)

## 라이선스

Private
