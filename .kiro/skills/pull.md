---
inclusion: manual
---

# pull — 부모 브랜치 → 현재 브랜치 동기화

레포 루트의 **`pull.sh`**를 실행하는 래퍼 스킬이다.
"pull", "부모 브랜치 동기화", "최신 받아와", "develop 받아와" 요청 시 사용.

## 부모 매핑
| 현재 브랜치 | 부모 |
|------------|------|
| main | 없음 (최상위) |
| develop | main |
| feature/* | develop |

## 실행 방법
```bash
./pull.sh [부모브랜치]    # 생략 시 자동 추론
```

## 동작 흐름
1. 부모 브랜치 결정 (인자 > 환경변수 > 매핑)
2. git fetch
3. dirty면 자동 stash
4. 전략 자동 선택: ff-only / merge / rebase
5. 충돌 시 abort → 깨끗한 상태 복원 + 리포트
6. stash 복원
