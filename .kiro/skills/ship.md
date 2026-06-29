---
inclusion: manual
---

# ship — 현재 브랜치 → 원격 + develop 통합

레포 루트의 **`ship.sh`**를 실행하는 래퍼 스킬이다.
"ship", "올려", "develop에 반영", "커밋하고 푸시", "작업 반영", "통합해줘" 요청 시 사용.

## 스킬 분담
| 스킬 | 방향 | 역할 |
|------|------|------|
| `pull` | 부모 → 현재 (하향) | 부모 최신 내용을 현재 브랜치로 동기화 |
| **`ship`** | **현재 → develop (상향)** | **커밋 + 현재 브랜치 push + develop 머지/푸시** |
| `deploy` | develop → main → 서버 | 원격 서버 멱등 배포 |

## 실행 방법
```bash
./ship.sh ["커밋 메시지"]
```

## 동작 흐름
1. uncommitted(추적 파일) 있으면 `git add -u` → 커밋
2. 현재 브랜치 origin push
3. 현재 → develop 머지(--no-ff) 후 origin/develop push
4. 원래 브랜치로 복귀
5. 충돌 시 자동 abort → 원래 브랜치 복귀 → 충돌 파일 리포트
