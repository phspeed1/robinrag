# AntiGravity 프로젝트 Google Cloud 배포 계획

이 문서는 AntiGravity 스택(React, Node.js, Python FastAPI)을 Google Cloud Platform (GCP)의 Google Compute Engine (GCE)과 Docker Compose를 사용하여 배포하기 위한 전략 및 가이드입니다. 이미 생성된 인스턴스 정보를 기반으로 작성되었습니다.

## 1. 프로젝트 구성 정보 (Configuration)
- **GCP 프로젝트 ID**: `project-e063da80-f7b1-4dbd-bba`
- **리전 (Region)**: `asia-northeast3` (서울)
- **인스턴스 이름**: `antigravity-server`
- **외부 IP 주소 (Static IP)**: `robinrag.duckdns.org`
- **계정**: `barcornsuck@gmail.com`

## 2. 아키텍처 개요 (Architecture)
애플리케이션은 3개의 Docker 컨테이너로 구성되며 Docker Compose로 관리됩니다.

1.  **Frontend (`client`)**:
    -   **기술 스택**: React (Vite), Nginx
    -   **포트**: 80 (HTTP)
    -   **역할**: 사용자 인터페이스 제공. Nginx가 정적 파일을 서빙하고 라우팅을 담당합니다.
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
이미 생성된 VM의 사양은 다음과 같습니다.

-   **머신 유형**: `e2-standard-2`
    -   **CPU**: 2 vCPUs
    -   **메모리**: 8 GB
    -   **선정 이유**: PDF 이미지 변환 및 Vision API 처리는 메모리 사용량이 많습니다. 4GB 이하(e2-medium) 모델 사용 시 OOM(메모리 부족) 현상이 발생할 수 있어 8GB 모델이 권장됩니다.
-   **OS**: Ubuntu 22.04 LTS
-   **방화벽**: HTTP(80), HTTPS(443) 트래픽 허용 필수.

## 4. 배포 절차 (Deployment Steps)

### 단계 1: 서버 접속 (SSH)
로컬 터미널에서 아래 명령어로 생성된 VM에 접속합니다.
```bash
gcloud compute ssh antigravity-server --project=project-e063da80-f7b1-4dbd-bba --zone=asia-northeast3-a
```

### 단계 2: 기본 설정 및 코드 다운로드
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

### 단계 3: 환경 변수 설정 (Environment Configuration)
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
    # 클라이언트 URL은 생성한 고정 IP를 사용합니다.
    CLIENT_URL="http://robinrag.duckdns.org"
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
    # CORS 허용 출처 설정
    ALLOWED_ORIGINS="http://robinrag.duckdns.org,http://localhost"
    ```

### 단계 4: 서비스 빌드 및 실행
Docker Compose를 사용하여 모든 서비스를 빌드하고 백그라운드에서 실행합니다.

```bash
sudo docker compose up -d --build
```

### 단계 5: 작동 확인
브라우저 주소창에 `http://robinrag.duckdns.org` 를 입력하여 접속되는지 확인합니다.

## 5. 유지보수 및 모니터링
-   **로그 확인**: `sudo docker compose logs -f`
-   **서비스 재시작**: `sudo docker compose restart`
-   **코드 업데이트 후 재배포** (권장 명령어):
    ```bash
    git pull
    # 중요: 백엔드 컨테이너 IP 변경 시 Nginx가 인식하도록 Nginx도 재시작해야 502 에러를 방지할 수 있습니다.
    sudo docker compose up -d --build && sudo docker compose restart nginx
    ```
-   **디스크 정리**: 배포가 반복되면 미사용 이미지가 쌓일 수 있습니다.
    ```bash
    sudo docker system prune -f
    ```

## 6. 향후 과제 (SSL 적용)
현재는 HTTP(80)로 배포됩니다. 운영 환경을 위해서는 SSL(HTTPS) 적용이 필요합니다.
1.  도메인을 구매하여 `34.64.150.15`로 A 레코드 연결.
2.  Nginx 컨테이너 설정에 Certbot을 추가하거나, 앞단에 Nginx Proxy Manager 컨테이너를 두어 Let's Encrypt 인증서를 발급받는 것을 권장합니다.
