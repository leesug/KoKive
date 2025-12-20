# Kokive 프로젝트

새로운 독립 프로젝트입니다.

## 🚀 빠른 시작

### 1. npm 패키지 설치

Cafe24 서버 (RaiDrive 연결)에서:

```bash
cd u:/kokive
npm install
```

또는 PowerShell (관리자 권한):

```powershell
cd C:\inetpub\wwwroot\kokive
npm install
```

### 2. MySQL 데이터베이스 생성

**MySQL Workbench**에서:

1. saju 연결 열기
2. SQL 파일 열기: `u:\kokive\config\schema.sql` (또는 `C:\inetpub\wwwroot\kokive\config\schema.sql`)
3. 실행 (⚡ Execute)

### 3. IIS Application 설정

**IIS Manager** (inetmgr):

1. **Sites** → **sondaery.cafe24.com** → 우클릭 → **Add Application**
2. **Alias**: `kokive`
3. **Physical Path**: `C:\inetpub\wwwroot\kokive`
4. **OK**

### 4. IIS 재시작

PowerShell (관리자 권한):

```powershell
iisreset /restart
```

### 5. 테스트

브라우저에서:

- 메인: `http://sondaery.cafe24.com/kokive/`
- API: `http://sondaery.cafe24.com/kokive/api/test-mysql`

---

## 📁 프로젝트 구조

```
kokive/
├── server.js              # Express 서버 (포트 8081)
├── package.json           # npm 의존성
├── web.config             # IIS + iisnode 설정
├── README.md              # 이 파일
├── public/
│   └── index.html         # 메인 페이지
├── config/
│   └── schema.sql         # MySQL 스키마
├── iisnode/               # iisnode 로그
└── node_modules/          # npm 패키지
```

---

## 🔗 URL 구조

| 경로 | 설명 |
|------|------|
| `/kokive/` | 메인 페이지 |
| `/kokive/api/test-mysql` | MySQL 연결 테스트 |
| `/kokive/api/users` | 사용자 목록 조회 |

---

## 🗄️ 데이터베이스

- **이름**: `kokive`
- **테이블**: `kokive_users`
- **호스트**: `127.0.0.1:3306`
- **사용자**: `root`
- **비밀번호**: (없음)

---

## 📊 API 목록

### GET /api/test-mysql

MySQL 연결 상태 확인

**응답**:
```json
{
  "success": true,
  "message": "Kokive MySQL 연결 성공",
  "database": "kokive",
  "tables": ["kokive_users"]
}
```

### GET /api/users

사용자 목록 조회

**응답**:
```json
{
  "success": true,
  "users": [
    {
      "id": 1,
      "username": "alice",
      "email": "alice@example.com",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/users

새 사용자 생성

**요청**:
```json
{
  "username": "newuser",
  "email": "newuser@example.com"
}
```

**응답**:
```json
{
  "success": true,
  "message": "사용자 생성 성공",
  "userId": 6
}
```

---

## 🔧 문제 해결

### npm install 오류

```bash
# package-lock.json 삭제 후 재시도
rm package-lock.json
npm install
```

### MySQL 연결 실패

1. MySQL 서비스 실행 확인: `services.msc`
2. 데이터베이스 생성 확인: MySQL Workbench에서 `schema.sql` 실행
3. server.js의 dbConfig 확인

### IIS 404 오류

1. Physical Path 확인: `C:\inetpub\wwwroot\kokive`
2. web.config 파일 존재 확인
3. IIS 재시작: `iisreset /restart`

### iisnode 로그 확인

로그 위치:
- `C:\inetpub\wwwroot\kokive\iisnode\`
- 또는 브라우저: `http://sondaery.cafe24.com/kokive/iisnode/`

---

## 📚 관련 문서

- [프로젝트 분리 가이드](../saju-graph-server/PROJECT_SEPARATION_GUIDE.md)
- [IIS 설정 가이드](../saju-graph-server/IIS_SETUP_GUIDE.md)
- [MySQL 가이드](../saju-graph-server/DATABASE_GUIDE.md)

---

## ✅ 체크리스트

설정 완료 여부를 확인하세요:

- [ ] npm install 완료
- [ ] MySQL kokive 데이터베이스 생성
- [ ] IIS Application 추가
- [ ] IIS 재시작
- [ ] 브라우저 테스트 성공

---

**프로젝트**: Kokive
**버전**: 1.0.0
**생성일**: 2024-11-26
