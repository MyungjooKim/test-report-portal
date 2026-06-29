#!/usr/bin/env bash
# =============================================================================
# test-report-portal 멱등 배포 스크립트
#
#   흐름: (로컬) uncommitted 커밋 → push → develop→main 머지 → push
#         (서버) git reset --hard origin/main → docker build → docker run → 헬스체크
#
#   사용:  ./deploy.sh ["커밋 메시지"]
#   멱등성: 서버는 항상 origin/main 커밋에 reset --hard 되므로 N회 실행해도 동일 상태.
# =============================================================================
set -euo pipefail

# ── 설정 ─────────────────────────────────────────────────────────────────────
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-ubuntu@131.186.17.216}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/home/ubuntu/apps/test-report-portal}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/aws-key/okrd-pi-server.pem}"
SRC_BRANCH="${DEPLOY_SRC_BRANCH:-develop}"
DEPLOY_BRANCH="${DEPLOY_DEPLOY_BRANCH:-main}"
APP_PORT="${DEPLOY_APP_PORT:-6000}"
CONTAINER_NAME="${DEPLOY_CONTAINER_NAME:-tr-portal}"
IMAGE_NAME="${DEPLOY_IMAGE_NAME:-test-report-portal}"
COMMIT_MSG="${1:-chore: deploy $(date +%Y%m%d-%H%M%S)}"

SSH="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 사전 확인 ────────────────────────────────────────────────────────────────
[ -f "$SSH_KEY" ] || die "SSH 키 파일 없음: $SSH_KEY"

CURRENT_BRANCH=$(git branch --show-current)
log "현재 브랜치: $CURRENT_BRANCH"

# ── 1. 로컬: uncommitted 커밋 + push ────────────────────────────────────────
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log "uncommitted 변경 → 커밋"
  git add -u
  git commit -m "$COMMIT_MSG"
fi

log "push → origin/$CURRENT_BRANCH"
git push origin "$CURRENT_BRANCH" 2>/dev/null || git push -u origin "$CURRENT_BRANCH"

# ── 2. 로컬: develop → main 머지 ────────────────────────────────────────────
log "develop → main 머지"
git fetch origin --quiet

# develop이 main보다 앞서있으면 머지
BEHIND=$(git rev-list --count "origin/${DEPLOY_BRANCH}..origin/${SRC_BRANCH}" 2>/dev/null || echo 0)
if [ "$BEHIND" = "0" ]; then
  log "main 이 이미 최신 → 머지 skip"
else
  git checkout "$DEPLOY_BRANCH"
  git pull origin "$DEPLOY_BRANCH" --ff-only 2>/dev/null || true
  if git merge --no-ff "origin/${SRC_BRANCH}" -m "Merge $SRC_BRANCH into $DEPLOY_BRANCH for deploy"; then
    git push origin "$DEPLOY_BRANCH"
    log "✓ main 머지 + push 완료"
  else
    git merge --abort
    git checkout "$CURRENT_BRANCH"
    die "main 머지 충돌. 수동 해결 필요."
  fi
  git checkout "$CURRENT_BRANCH"
fi

DEPLOY_SHA=$(git rev-parse "origin/${DEPLOY_BRANCH}" | head -c 8)
log "배포 커밋: $DEPLOY_SHA"

# ── 3. 서버: git reset --hard ────────────────────────────────────────────────
log "서버 접속: $REMOTE_HOST"
$SSH "$REMOTE_HOST" bash -s <<EOF
  set -e
  cd "$REMOTE_DIR"
  git fetch origin --prune
  git reset --hard origin/$DEPLOY_BRANCH
  echo "서버 HEAD: \$(git rev-parse --short HEAD)"
EOF

# ── 4. 서버: Docker 빌드 + 실행 ─────────────────────────────────────────────
log "서버: Docker 빌드 + 재시작"
$SSH "$REMOTE_HOST" bash -s <<EOF
  set -e
  cd "$REMOTE_DIR"
  docker build -t $IMAGE_NAME .
  docker stop $CONTAINER_NAME 2>/dev/null || true
  docker rm $CONTAINER_NAME 2>/dev/null || true
  docker run -d --name $CONTAINER_NAME --restart unless-stopped \
    -p ${APP_PORT}:3000 \
    -v tr-portal-data:/app/uploads \
    -v tr-portal-db:/app/data \
    $IMAGE_NAME
  echo "컨테이너 시작됨"
EOF

# ── 5. 헬스체크 ──────────────────────────────────────────────────────────────
log "헬스체크..."
sleep 3
HTTP_CODE=$($SSH "$REMOTE_HOST" "curl -s -o /dev/null -w '%{http_code}' http://localhost:${APP_PORT}/login" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  log "✅ 배포 완료!"
  log "   커밋: $DEPLOY_SHA"
  log "   URL: http://$(echo $REMOTE_HOST | cut -d@ -f2):${APP_PORT}"
else
  warn "헬스체크 실패 (HTTP $HTTP_CODE)"
  log "서버 로그 확인:"
  $SSH "$REMOTE_HOST" "docker logs --tail 20 $CONTAINER_NAME" 2>&1 || true
  die "배포 후 헬스체크 실패"
fi
