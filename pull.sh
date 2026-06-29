#!/usr/bin/env bash
# =============================================================================
# test-report-portal 부모 브랜치 동기화 (부모 → 현재 브랜치)
#
#   브랜치 전략:  main ← develop ← feature/*
#   pull 은 하향 동기화 — 부모의 최신 내용을 현재 브랜치로 내려받는다.
#
#   부모 매핑: main → (없음), develop → main, feature/* → develop
#
#   사용:  ./pull.sh [부모브랜치]      # 생략 시 자동 추론
# =============================================================================
set -euo pipefail

# ── 설정 ─────────────────────────────────────────────────────────────────────
REMOTE="${PULL_REMOTE:-origin}"
ROOT_BRANCH="${PULL_ROOT_BRANCH:-main}"
INTEGRATION_BRANCH="${PULL_INTEGRATION_BRANCH:-develop}"
STRATEGY="${PULL_STRATEGY:-auto}"
DO_PUSH="${PULL_PUSH:-0}"

log()  { printf '\033[1;34m[pull]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 현재 브랜치 + 부모 결정 ──────────────────────────────────────────────────
CURRENT_BRANCH=$(git branch --show-current)
[ -z "$CURRENT_BRANCH" ] && die "detached HEAD 상태"

if [ -n "${1:-}" ]; then
  PARENT="$1"
elif [ -n "${PULL_PARENT:-}" ]; then
  PARENT="$PULL_PARENT"
elif [ "$CURRENT_BRANCH" = "$ROOT_BRANCH" ]; then
  log "$ROOT_BRANCH 는 최상위 → 동기화 불필요"
  exit 0
elif [ "$CURRENT_BRANCH" = "$INTEGRATION_BRANCH" ]; then
  PARENT="$ROOT_BRANCH"
else
  PARENT="$INTEGRATION_BRANCH"
fi

log "현재: $CURRENT_BRANCH ← 부모: $PARENT"

# ── fetch ────────────────────────────────────────────────────────────────────
git fetch "$REMOTE" --prune --quiet

# ── stash ────────────────────────────────────────────────────────────────────
STASHED=0
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log "작업트리 dirty → stash"
  git stash push -m "pull-auto-stash"
  STASHED=1
fi

# ── 관계 분석 ────────────────────────────────────────────────────────────────
REMOTE_PARENT="${REMOTE}/${PARENT}"
if ! git rev-parse --verify "$REMOTE_PARENT" >/dev/null 2>&1; then
  [ "$STASHED" = "1" ] && git stash pop
  die "원격 브랜치 $REMOTE_PARENT 가 존재하지 않습니다."
fi

BEHIND=$(git rev-list --count "HEAD..${REMOTE_PARENT}" 2>/dev/null || echo 0)
AHEAD=$(git rev-list --count "${REMOTE_PARENT}..HEAD" 2>/dev/null || echo 0)

if [ "$BEHIND" = "0" ]; then
  log "이미 최신 (부모 대비 뒤처진 커밋 없음)"
  [ "$STASHED" = "1" ] && git stash pop
  exit 0
fi

log "부모 대비: +${AHEAD} (현재만의 커밋) / -${BEHIND} (뒤처진 커밋)"

# ── 전략 결정 ────────────────────────────────────────────────────────────────
if [ "$STRATEGY" = "auto" ]; then
  if [ "$AHEAD" = "0" ]; then
    STRATEGY="ff-only"
  elif git rev-parse --verify "${REMOTE}/${CURRENT_BRANCH}" >/dev/null 2>&1; then
    STRATEGY="merge"  # 이미 push 된 브랜치 → merge
  else
    STRATEGY="rebase" # 로컬 전용 → rebase
  fi
fi

log "전략: $STRATEGY"

# ── 동기화 실행 ──────────────────────────────────────────────────────────────
case "$STRATEGY" in
  ff-only)
    git merge --ff-only "$REMOTE_PARENT"
    ;;
  merge)
    if ! git merge "$REMOTE_PARENT" -m "Merge $PARENT into $CURRENT_BRANCH"; then
      warn "충돌 발생 → merge abort"
      git merge --abort
      [ "$STASHED" = "1" ] && git stash pop
      die "머지 충돌. 충돌 파일을 수동으로 해결 후 재시도하세요."
    fi
    ;;
  rebase)
    if ! git rebase "$REMOTE_PARENT"; then
      warn "충돌 발생 → rebase abort"
      git rebase --abort
      [ "$STASHED" = "1" ] && git stash pop
      die "리베이스 충돌. 충돌 파일을 수동으로 해결 후 재시도하세요."
    fi
    ;;
  *)
    die "알 수 없는 전략: $STRATEGY"
    ;;
esac

# ── stash 복원 ───────────────────────────────────────────────────────────────
[ "$STASHED" = "1" ] && git stash pop

# ── push (옵션) ──────────────────────────────────────────────────────────────
if [ "$DO_PUSH" = "1" ]; then
  if [ "$STRATEGY" = "rebase" ]; then
    git push --force-with-lease "$REMOTE" "$CURRENT_BRANCH"
  else
    git push "$REMOTE" "$CURRENT_BRANCH"
  fi
  log "push 완료"
fi

log "✅ pull 완료 ($PARENT → $CURRENT_BRANCH)"
