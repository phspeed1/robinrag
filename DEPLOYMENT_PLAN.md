# RobinRag 프로젝트 Google Cloud 및 Docker 배포 가이드

이 문서는 GCP(Google Compute Engine) VM 및 Docker Compose 환경을 기반으로 RobinRag 프로젝트를 무중단/보안 설계를 고려하여 실질적이고 즉시 배포할 수 있도록 정리한 실무 배포 가이드라인입니다.

---

## 1. 인프라스트럭처 명세 (Infrastructure Details)

- **배포 서버 도메인**: `robinrag.duckdns.org`
  - DuckDNS 계정: `barcornsuck@gmail.com`
  - DuckDNS 토큰: `7c58ae30-4cec-445c-9361-4dac706f4e23`
- **대상 인스턴스**: GCP VM `e2-micro` (Ubuntu 22.04 LTS)
  - 스펙: 2 vCPUs, 1 GB RAM (물리 RAM의 협소함을 극복하기 위해 **4GB swap 가상 메모리** 등록 필수)
- **Supabase Cloud ID**: `pshuhtpjbikvrhsxmbcd`
  - 대시보드 주소: [https://supabase.com/dashboard/project/pshuhtpjbikvrhsxmbcd](https://supabase.com/dashboard/project/pshuhtpjbikvrhsxmbcd)
- **Pinecone Vector 인덱스**: `antigravity-rag-two`

---

## 2. 서버 사전 세팅 (Host VM Initialization)

인프라 생성 직후, 1GB 물리 메모리로 도커 빌드를 시도하면 RAM 부족으로 먹통(OOM) 현상이 나타납니다. 4GB swap 메모리를 우선 설정해야 합니다.

### 2.1 스왑 가상 메모리(4GB) 구성 명령어
VM 인스턴스 SSH 세션에서 다음 명령어를 순서대로 실행합니다:
```bash
# 4GB 용량의 공간 할당
sudo fallocate -l 4G /swapfile

# 파일 권한 강화 (루트 이외의 접근 통제)
sudo chmod 600 /swapfile

# 스왑 파티션으로 포맷
sudo mkswap /swapfile

# 가상 메모리 스왑 시스템 활성화
sudo swapon /swapfile

# 서버 재부팅 시에도 자동으로 마운트되도록 설정 추가
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 스왑 메모리가 올바르게 활성화되었는지 크기 검증
free -h
```

### 2.2 Docker & 런타임 설치
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose git curl
```

---

## 3. 소스코드 다운로드 및 환경 변수 구성 (Setup Code & Env)

모든 프로젝트 빌드 및 배포 명령어는 **/home/[계정]/app** 디렉토리(`~/app`) 내에서 가동하는 것을 엄격한 기본 규칙으로 합니다.

### 3.1 소스 가져오기
```bash
# 최초 설치 시
git clone https://github.com/phspeed1/robinrag.git ~/app
cd ~/app

# 이후 소스 갱신 시
cd ~/app && git pull
```

### 3.2 로컬 설정 파일 (.env) 직접 작성
소스 유출 방지를 위해 `.env` 파일은 서버의 로컬 디스크 상에 아래 포맷대로 기입하여 구성합니다.

1. **백엔드 Express 서버 환경설정** (`~/app/server/.env`)
   ```env
   PORT=3000
   DATABASE_URL="postgresql://postgres:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?pgbouncer=true"
   SESSION_SECRET="your_strong_session_secret"
   CLIENT_URL="https://robinrag.duckdns.org"
   SUPABASE_URL="https://pshuhtpjbikvrhsxmbcd.supabase.co"
   SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

2. **LLM RAG 파이썬 서비스 환경설정** (`~/app/llm_service/.env`)
   ```env
   OPENAI_API_KEY="sk-proj-..."
   SUPABASE_URL="https://pshuhtpjbikvrhsxmbcd.supabase.co"
   SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   JWT_SECRET="your_strong_session_secret" # 백엔드의 SESSION_SECRET과 일치 필수
   PINECONE_API_KEY="your-pinecone-api-key"
   PINECONE_INDEX_NAME="antigravity-rag-two"
   ALLOWED_ORIGINS="https://robinrag.duckdns.org,http://localhost"
   ```

---

## 4. HTTPS (SSL) 인증서 최초 발급 및 Nginx 적용 (SSL Setup)

Let's Encrypt를 통한 무료 인증서 발급 검증(ACME)을 위해, 80포트를 열어두고 인증을 획득한 후 443 암호화 설정을 다시 바인딩하는 단계입니다.

### 4.1 Nginx 443 블록 임시 주석 처리
`~/app/nginx/default.conf` 파일을 텍스트 에디터로 실행하여, **`listen 443 ssl;`이 포함된 서버 블록 전체**를 임시 주석 처리(`#`)하여 저장합니다.

### 4.2 컨테이너 서비스 최초 실행
```bash
cd ~/app
sudo docker compose up -d
```

### 4.3 Certbot 컨테이너 기반 SSL 발급 요청
공유 볼륨에 마운트된 웹루트 경로로 도메인 검증서를 원격 요청하는 명령어입니다:
```bash
sudo docker compose run --rm --entrypoint "certbot certonly --webroot --webroot-path=/var/www/certbot -d robinrag.duckdns.org --non-interactive --agree-tos --email barcornsuck@gmail.com" certbot
```
*성공 시 `/etc/letsencrypt/live/robinrag.duckdns.org/` 경로에 키 파일들이 발급되어 저장됩니다.*

### 4.4 Nginx 복원 및 가동
1. `~/app/nginx/default.conf`로 돌아가 임시 주석 해제하여 **`443 ssl` 서버 블록을 다시 복원**합니다.
2. 컴포즈 다운 후 다시 로드하고 백엔드 웹 서버를 최종 리셋합니다.
```bash
sudo docker compose down
sudo docker compose up -d
sudo docker compose restart server
```

---

## 5. Hermes Agent 독립 실행 및 네트워크 바인딩 (Hermes Integration)

RobinRag 프로젝트와 결합도(Coupling)를 낮추고, 무중단 상시 가동 환경을 구축하기 위해 Hermes Agent를 독립된 별도의 Docker 컨테이너로 실행하되, Nginx 리버스 프록시 및 내부 API 통신이 가능하도록 **동일 가상 네트워크(`robinrag_network`)**에 바인딩합니다.

### 5.1 Docker 가상 네트워크 확인
RobinRag의 `docker-compose.yml`이 실행되면서 `robinrag_network`라는 이름의 네트워크가 자동으로 생성됩니다. 만약 사전에 단독으로 네트워크를 강제 생성하고 싶다면 아래 명령어를 사용합니다:
```bash
sudo docker network create robinrag_network
```

### 5.2 Hermes 독립 컨테이너 구동 명령어
Hermes 에이전트를 독립적으로 띄울 때, 생성된 `robinrag_network`를 지정하여 구동합니다. (호스트 포트 `8642`는 외부에 노출하지 않고 Nginx가 도커 내부망에서 이름을 통해 찾도록 구성하므로 방화벽을 닫아두어도 안전합니다.)
```bash
sudo docker run -d \
  --name hermes \
  --network robinrag_network \
  --restart always \
  -v ~/hermes_data:/opt/data \
  nousresearch/hermes-agent:latest
```

### 5.3 Nginx 설정 적용
`/app/nginx/default.conf`에 명시된 `/hermes/` 로케이션 맵핑이 내부 도메인 `http://hermes:8642/`를 성공적으로 해석하여 프록싱합니다. 수정 완료 후 Nginx 컨테이너를 재시작합니다.
```bash
sudo docker compose restart nginx
```

---

## 6. 일상 운영 및 관리를 위한 명령어 모음 (Operations)

### 6.1 개별 컨테이너 신속 빌드 및 재배포
전체 시스템 다운타임 없이 수정한 특정 서비스(예: 백엔드 `server`)만 이미지 변경분을 새로 적용하여 띄우고 싶을 때 사용합니다.
```bash
# server 서비스만 타겟 이미지 빌드 후 즉시 가동
sudo docker compose up -d --build server
```

### 6.2 컨테이너별 실시간 로그 진단
서비스가 먹통이 되거나 RAG 오류가 날 때 원인 분석을 위해 컨테이너 내부 런타임 로그를 모니터링합니다.
```bash
# docker-compose 전체 통합 로그
sudo docker compose logs -f

# LLM 파이썬 서비스 실시간 콘솔 추적
sudo docker compose logs -f llm_service

# 백엔드 노드 서비스 실시간 콘솔 추적
sudo docker compose logs -f server
```

---

## 7. 인프라 자동 유지보수 크론탭 (Automation Cron)

### 7.1 Supabase 비활성화 방지 (Keep-Alive) 자동화
Supabase 무료 플랜은 1주일 동안 실활성 트래픽이 유입되지 않으면 강제로 일시정지 상태가 됩니다. 이를 방지하기 위해 GCP VM Host 레벨에서 매 6시간마다 Supabase REST API 게이트웨이로 핑(Ping)을 전송하는 스크립트를 주기 등록합니다.

```bash
# VM 호스트 크론탭 편집기 진입
sudo crontab -e
```
하단에 아래와 같이 실제 Supabase API 키와 도메인이 포함된 핑 명령어를 추가하고 저장합니다:
```bash
0 */6 * * * curl -i -s -k -X GET "https://pshuhtpjbikvrhsxmbcd.supabase.co/rest/v1/" -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzaHVodHBqYmlrdnJoc3htYmNkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTUzMjg5NCwiZXhwIjoyMDgxMTA4ODk0fQ.3qkUuKnev0OQVfolqT13W-3aMduz1p2Z9vATQQQ466k" > /dev/null 2>&1
```

### 7.2 SSL 90일 만료 대비 자동 갱신
3개월 만료일을 감안하여 12시간 주기로 백그라운드 체크가 동작합니다. 인증서 갱신 시 Nginx 웹 서버에 반영하기 위해 매월 1일 새벽 3시에 Nginx를 재부팅하도록 설정합니다.
```bash
# VM 호스트 크론탭 등록 명령어 추가
0 3 1 * * docker compose -f /home/[Your_User]/app/docker-compose.yml restart nginx
```

---

## 8. 로컬 개발 환경 실행 (Local Run)

개발 PC의 로컬 윈도우 환경에서 개발 및 컨테이너 동작 테스트를 원할 경우 아래 명령어를 사용해 독립적으로 구동합니다:
```powershell
docker compose -f docker-compose.local.yml up -d --build
```
