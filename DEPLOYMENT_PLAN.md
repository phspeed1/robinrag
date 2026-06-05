# AntiGravity 프로젝트 Google Cloud 배포 계획

이 문서는 AntiGravity 스택(React, Node.js, Python FastAPI)을 Google Cloud Platform (GCP)의 Google Compute Engine (GCE)과 Docker Compose를 사용하여 배포하기 위한 전략 및 가이드입니다. 새로 생성된 인스턴스 정보를 기반으로 작성되었습니다.

## 1. 프로젝트 구성 정보 (Configuration)
- **GCP 프로젝트 ID**: `project-e063da80-f7b1-4dbd-bba`
- **리전 (Region)**: `us-central1-a`
- **인스턴스 이름**: `instance-20260605-081755`
- **도메인 (Domain)**: `robinrag.duckdns.org` (기존 `34.64.150.15.sslip.io`에서 변경)
- **계정**: `barcornsuck@gmail.com`
- **SSL 상태**: 미설정 (신규 서버 배포 진행 후 Certbot/Let's Encrypt를 통해 SSL 설정 예정)

## 2. 아키텍처 개요 (Architecture)
애플리케이션은 3개의 Docker 컨테이너로 구성되며 Docker Compose로 관리됩니다.

1.  **Frontend (`client`)**:
    -   **기술 스택**: React (Vite), Nginx
    -   **포트**: 80 (HTTP), 443 (HTTPS - SSL 적용 시)
    -   **역할**: 사용자 인터페이스 제공. Nginx가 정적 파일을 서빙하고 Reverse Proxy 및 라우팅(API 요청 전달)을 담당합니다.
2.  **Backend (`server`)**:
    -   **기술 스택**: Node.js (Express, Prisma)
    -   **포트**: 3000
    -   **역할**: Google OAuth 인증, 사용자 관리, 채팅 세션 기록 (Supabase PostgreSQL 연동).
3.  **LLM Service (`llm_service`)**:
    -   **기술 스택**: Python (FastAPI)
    -   **포트**: 8000
    -   **역할**: RAG 파이프라인 및 PDF 처리 엔진.
    -   **PDF 처리 방식 (Hybrid)**:
        -   **텍스트**: `PyMuPDF (fitz)`를 사용하여 직접 추출.
        -   **이미지/도표**: 이미지를 추출하여 **Supabase Storage**에 임시 업로드 -> **GPT-4o-mini Vision**으로 분석 -> 분석 후 즉시 삭제. (로컬 디스크 의존성 없음)

## 3. 인프라 사양 (Infrastructure)
새로 생성된 VM의 사양은 다음과 같습니다.

-   **머신 유형**: `e2-micro` (GCP 평생 무료 티어 대상)
    -   **CPU**: 2 vCPUs (shared)
    -   **메모리**: 1 GB 물리 메모리
    -   **스왑 메모리**: 4 GB 스왑 파일 추가 설정 필수 (물리 메모리 1GB로 도커 빌드 및 LLM RAG 서비스 운영 시 OOM 에러가 무조건 발생하므로 스왑이 반드시 필요함).
-   **OS**: Ubuntu 22.04 LTS
-   **방화벽 설정 (GCP 방화벽 규칙)**: HTTP(80), HTTPS(443) 트래픽 허용 필수.

## 4. 배포 절차 (Deployment Steps)

### 단계 1: 서버 접속 (SSH)
로컬 터미널에서 아래 명령어로 생성된 us-central1-a 존의 VM에 접속합니다.
```bash
gcloud compute ssh instance-20260605-081755 --project=project-e063da80-f7b1-4dbd-bba --zone=us-central1-a
```

### 단계 2: 스왑 메모리 설정 (4GB)
1GB의 제한적인 RAM 크기 문제를 해결하기 위해 4GB 크기의 스왑 파일을 생성하고 등록합니다.

1.  **4GB 크기의 스왑 파일 생성**:
    ```bash
    sudo fallocate -l 4G /swapfile
    ```
2.  **권한 설정 (보안)**:
    ```bash
    sudo chmod 600 /swapfile
    ```
3.  **스왑 영역 구축**:
    ```bash
    sudo mkswap /swapfile
    ```
4.  **스왑 파일 활성화**:
    ```bash
    sudo swapon /swapfile
    ```
5.  **시스템 재부팅 시 자동 활성화 등록**:
    ```bash
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    ```
6.  **활성화 여부 확인**:
    ```bash
    free -h
    ```

### 단계 3: 기본 설정 및 코드 다운로드
VM 내부에서 실행하는 명령어입니다.

1.  **필수 도구 설치 (Docker & Git)**
    ```bash
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose git
    ```

2.  **프로젝트 클론**
    ```bash
    # Git 저장소 주소는 실제 주소로 변경해주세요. (예: GitHub, GitLab 등)
    git clone <YOUR_GIT_REPOSITORY_URL> app
    cd app
    ```

### 단계 4: 환경 변수 설정 (Environment Configuration)
보안상 `.env` 파일은 저장소에 포함되지 않았으므로, 서버에서 **직접 생성**해야 합니다.

1.  **Backend 환경 변수** (`server/.env`)
    ```bash
    nano server/.env
    ```
    ```env
    PORT=3000
    DATABASE_URL="postgresql://..."
    # 실제 운영용 비밀 키를 생성하여 입력하세요.
    SESSION_SECRET="<강력한_랜덤_문자열>"
    # 클라이언트 URL은 변경된 duckdns 도메인을 사용합니다.
    CLIENT_URL="http://robinrag.duckdns.org" # SSL 적용 전
    # SSL 적용 후에는 https://robinrag.duckdns.org 로 변경해야 합니다.
    ```

2.  **LLM Service 환경 변수** (`llm_service/.env`)
    ```bash
    nano llm_service/.env
    ```
    ```env
    OPENAI_API_KEY="sk-..."
    SUPABASE_URL="https://..."
    SUPABASE_KEY="<SERVICE_ROLE_KEY>"
    # 중요: Server의 SESSION_SECRET과 정확히 일치해야 합니다.
    JWT_SECRET="<SESSION_SECRET과_동일한_값>"
    # CORS 허용 출처 설정 (도메인 변경 반영)
    ALLOWED_ORIGINS="http://robinrag.duckdns.org,https://robinrag.duckdns.org,http://localhost"
    ```

### 단계 5: 서비스 빌드 및 실행
Docker Compose를 사용하여 모든 서비스를 빌드하고 백그라운드에서 실행합니다.

```bash
sudo docker compose up -d --build
```

### 단계 6: 작동 확인
브라우저 주소창에 `http://robinrag.duckdns.org` 를 입력하여 접속되는지 확인합니다.

---

## 5. SSL (HTTPS) 구성 가이드 (Let's Encrypt & Certbot)
현재 SSL 설정이 되어 있지 않으므로 HTTP(80)로만 접근 가능합니다. DuckDNS 도메인(`robinrag.duckdns.org`)에 Let's Encrypt를 통해 무료 SSL 인증서를 발급하고 HTTPS를 설정하는 방법입니다.

### 방법 1: VM 호스트에 Certbot을 직접 설치하고 Nginx 컨테이너와 연동 (권장)

1.  **Certbot 및 패키지 설치**
    ```bash
    sudo apt-get update
    sudo apt-get install -y certbot
    ```

2.  **임시로 HTTP 포트(80)를 비워두기 위해 Nginx 컨테이너를 중지**
    ```bash
    sudo docker compose stop nginx
    ```

3.  **Certbot standalone 방식으로 인증서 발급**
    ```bash
    sudo certbot certonly --standalone -d robinrag.duckdns.org
    ```
    - 이메일 주소 입력 및 약관 동의 절차를 진행합니다.
    - 성공 시 `/etc/letsencrypt/live/robinrag.duckdns.org/` 경로에 인증서가 생성됩니다.

4.  **Docker Compose 및 Nginx 설정 파일 수정**
    인증서 볼륨을 Nginx 컨테이너에 마운트하고 443 포트를 바인딩해야 합니다.
    
    - **`docker-compose.yml` 수정 예시 (Nginx 부분)**:
      ```yaml
      nginx:
        # ... 기존 설정 ...
        ports:
          - "80:80"
          - "443:443"
        volumes:
          - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
          - /etc/letsencrypt:/etc/letsencrypt:ro
      ```

    - **`nginx.conf` 수정 예시 (SSL 적용)**:
      ```nginx
      server {
          listen 80;
          server_name robinrag.duckdns.org;
          # 모든 HTTP 요청을 HTTPS로 리다이렉트
          return 301 https://$host$request_uri;
      }

      server {
          listen 443 ssl;
          server_name robinrag.duckdns.org;

          ssl_certificate /etc/letsencrypt/live/robinrag.duckdns.org/fullchain.pem;
          ssl_certificate_key /etc/letsencrypt/live/robinrag.duckdns.org/privkey.pem;

          # 기존 리버스 프록시 설정들...
          location / {
              proxy_pass http://client:80;
              # ...
          }
      }
      ```

5.  **설정 반영 및 재시작**
    ```bash
    sudo docker compose up -d --build
    ```

6.  **Backend 환경변수 업데이트**
    `server/.env` 파일의 `CLIENT_URL`을 `https://robinrag.duckdns.org` 로 업데이트하고 백엔드 서비스를 재시작합니다.
    ```bash
    sudo docker compose restart server
    ```

---

## 6. 유지보수 및 모니터링
-   **로그 확인**: `sudo docker compose logs -f`
-   **서비스 재시작**: `sudo docker compose restart`
-   **코드 업데이트 후 재배포**:
    ```bash
    git pull
    sudo docker compose up -d --build && sudo docker compose restart nginx
    ```
-   **SSL 인증서 자동 갱신 등록 (Cron)**
    Let's Encrypt 인증서는 90일 만료이므로 자동 갱신을 위해 crontab에 등록합니다.
    ```bash
    # 크론탭 편집 열기
    sudo crontab -e
    # 매월 1일 새벽 3시에 갱신 시도 후 nginx 컨테이너 재시작하도록 아래 행 추가
    0 3 1 * * certbot renew --post-hook "docker compose -f /home/<USER>/app/docker-compose.yml restart nginx"
    ```
-   **디스크 정리**:
    ```bash
    sudo docker system prune -f
    ```
