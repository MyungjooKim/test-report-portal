---
inclusion: manual
---

# deploy — 원격 서버 멱등 배포

레포 루트의 **`deploy.sh`**를 실행하는 래퍼 스킬이다.
"deploy", "서버에 올려줘" 요청 시 사용.

## 동작 흐름
1. **로컬**: uncommitted 변경이 있으면 커밋
2. **로컬**: 현재 브랜치 push
3. **로컬**: develop → main 머지 후 push (이미 반영됐으면 skip)
4. **서버**: git fetch → git reset --hard origin/main (멱등 핵심)
5. **서버**: docker build → docker stop/rm → docker run
6. **서버**: 헬스체크 (/login 200)

## 실행 방법
```bash
./deploy.sh ["커밋 메시지"]
```

## 설정 (환경변수 override)
| 변수 | 기본값 | 설명 |
|------|--------|------|
| DEPLOY_REMOTE_HOST | ubuntu@131.186.17.216 | 서버 주소 |
| DEPLOY_REMOTE_DIR | /home/ubuntu/apps/test-report-portal | 서버 프로젝트 경로 |
| DEPLOY_SSH_KEY | ~/aws-key/okrd-pi-server.pem | SSH 키 |
| DEPLOY_APP_PORT | 6000 | 외부 포트 |
| DEPLOY_CONTAINER_NAME | tr-portal | 컨테이너 이름 |

## 멱등성
서버는 항상 origin/main 커밋에 reset --hard 되므로 N회 실행해도 동일 결과.
데이터(Docker volume)와 .env(gitignored)는 보존된다.

## 사전 조건
- SSH 키 파일 존재 + 서버 접속 가능
- 서버에 프로젝트 디렉토리가 git clone 되어 있음
- 서버에 .env 파일이 설정되어 있음 (GOOGLE_CLIENT_ID 등)

## 실패 시
- SSH 실패: 키 경로/권한 확인
- 머지 충돌: develop/main 수동 정리 후 재실행
- 헬스체크 실패: docker logs 확인
