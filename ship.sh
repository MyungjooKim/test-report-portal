#!/usr/bin/env bash
# =============================================================================
# test-report-portal 작업 반영 스크립트 (현재 브랜치 → 원격 + develop)
#
#   브랜치 전략:  main ← develop ← feature/*
#   ship 은 상향 통합 단계 — 현재(feature) 작업을 커밋하고
#           ① 현재 브랜치를 원격에 push  ② develop 으로 머지 후 push 한다.
#           (배포는 deploy 스킬: develop → main → 서버)
#
#   사용:  ./ship.sh ["커밋 메시지"]      # 메시지 생략 시 자동 생성
# =============================================================================
set -euo pipefail

# ── 설정 ─────────────────────────────────────────────────────────────────────
REMOTE="${SHIP_REMOTE:-origin}"
INTEGRATION_BRANCH="${SHIP_INTEGRATION_BRANCH:-develop}"
ROOT_BRANCH="${SHIP_ROOT_BRANCH:-main}"
NO_DEVELOP="${SHIP_NO_DEVELOP:-0}"
COMMIT_MSG="${1:-chore: ship $(date +%Y%m%d-%H%M%S)}"

log()  { printf '\033[1;34m[ship]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 현재 브랜치 확인 ─────────────────────────────────────────────────────────
CURRENT_BRANCH=$(git branch --show-current)
[ -z "$CURRENT_BRANCH" ] && die "detached HEAD 상태. 브랜치를 checkout 하세요."

log "현재 브랜치: $CURRENT_BRANCH"

# ── 1. uncommitted 변경 커밋 ─────────────────────────────────────────────────
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log "uncommitted 변경 감지 → 커밋"
  git add -u
  git commit -m "$COMMIT_MSG"
else
  log "커밋할 변경 없음"
fi

# ── 2. 현재 브랜치 push ──────────────────────────────────────────────────────
if git rev-parse --verify "${REMOTE}/${CURRENT_BRANCH}" >/dev/null 2>&1; then
  log "push → ${REMOTE}/${CURRENT_BRANCH}"
  git push "$REMOTE" "$CURRENT_BRANCH"
else
  log "upstream 설정 + push → ${REMOTE}/${CURRENT_BRANCH}"
  git push -u "$REMOTE" "$CURRENT_BRANCH"
fi

# ── 3. develop 머지 ──────────────────────────────────────────────────────────
if [ "$NO_DEVELOP" = "1" ]; then
  log "SHIP_NO_DEVELOP=1 → develop 머지 생략"
elif [ "$CURRENT_BRANCH" = "$ROOT_BRANCH" ]; then
  warn "현재가 $ROOT_BRANCH → develop 머지 생략 (역류 방지)"
elif [ "$CURRENT_BRANCH" = "$INTEGRATION_BRANCH" ]; then
  log "현재가 $INTEGRATION_BRANCH → 이미 push 완료"
else
  # develop 에 이미 반영됐는지 확인
  git fetch "$REMOTE" "$INTEGRATION_BRANCH" --quiet
  MERGE_BASE=$(git merge-base "$CURRENT_BRANCH" "${REMOTE}/${INTEGRATION_BRANCH}")
  CURRENT_SHA=$(git rev-parse "$CURRENT_BRANCH")

  if [ "$MERGE_BASE" = "$CURRENT_SHA" ]; then
    log "이미 $INTEGRATION_BRANCH 에 반영됨 → 머지 skip"
  else
    log "→ $INTEGRATION_BRANCH 머지"

    # 작업트리 stash
    STASHED=0
    if ! git diff --quiet 2>/dev/null; then
      git stash push -m "ship-auto-stash"
      STASHED=1
    fi

    git checkout "$INTEGRATION_BRANCH"
    git pull "$REMOTE" "$INTEGRATION_BRANCH" --ff-only 2>/dev/null || true

    if git merge --no-ff "$CURRENT_BRANCH" -m "Merge $CURRENT_BRANCH into $INTEGRATION_BRANCH"; then
      git push "$REMOTE" "$INTEGRATION_BRANCH"
      log "✓ $INTEGRATION_BRANCH 머지 + push 완료"
    else
      warn "충돌 발생 → merge abort"
      git merge --abort
      git checkout "$CURRENT_BRANCH"
      [ "$STASHED" = "1" ] && git stash pop
      die "$INTEGRATION_BRANCH 머지 중 충돌. pull 로 동기화 후 재시도하세요."
    fi

    git checkout "$CURRENT_BRANCH"
    [ "$STASHED" = "1" ] && git stash pop
  fi
fi

log "✅ ship 완료 ($CURRENT_BRANCH → ${REMOTE})"
