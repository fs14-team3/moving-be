# moving-be

무빙(이사 소비자와 기사님 견적 매칭 서비스)의 백엔드 API입니다.

## 기술 스택

Node.js 24 · Express 5 · TypeScript · Prisma 7 · PostgreSQL 18 · Helmet · ESLint · Prettier · Knip · Husky · GitHub Actions · AWS (EC2 · RDS · S3) · PM2 · Nginx

## 시작하기

요구 사항: Node.js 24 (`.nvmrc`), npm 11+, PostgreSQL 18 (운영 DB와 같은 버전)

```bash
nvm use
npm install
cp .env.example .env     # DATABASE_URL을 로컬 DB에 맞게 수정
npm run prisma:generate
npm run dev              # http://localhost:4000/api/health
```

## 환경 변수

| 이름                | 예시                                        | 설명                                                                                  |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `PORT`              | `4000`                                      | API 서버 포트                                                                         |
| `HOST`              | `127.0.0.1`                                 | 바인딩 주소. 생략 시 모든 인터페이스, 운영(Nginx 뒤)은 `127.0.0.1`                    |
| `CLIENT_ORIGIN`     | `http://localhost:3000`                     | CORS 허용 프론트 주소                                                                 |
| `DATABASE_URL`      | `postgresql://…@localhost:5432/moving`      | PostgreSQL 연결 문자열                                                                |
| `TEST_DATABASE_URL` | `postgresql://…@localhost:5432/moving_test` | `npm test` 전용 DB. 테스트가 모든 행을 지우므로 `DATABASE_URL`과 다른 DB를 사용합니다 |
| `NODE_ENV`          | `development`                               | `development` / `production`                                                          |
| `SENTRY_DSN`        | `https://…@o0.ingest.sentry.io/0`           | Sentry 에러 수집 DSN. 생략하면 Sentry를 사용하지 않습니다 (로컬은 생략)               |
| `TRUST_PROXY`       | `0`                                         | 신뢰할 프록시 홉 수. 로컬 `0`, Nginx 뒤 `1`, Cloudflare·로드밸런서 + Nginx는 `2`      |

새 환경 변수를 추가하면 `.env.example`과 이 표를 같은 PR에서 수정합니다.

`CLIENT_ORIGIN`은 쉼표로 여러 origin을 지정할 수 있습니다. 경로나 끝의 `/`는 넣지 않습니다.
운영 환경에서는 이 값을 명시합니다. `DATABASE_URL`은 DB 연결에 필요하며,
빌드(`prisma generate`)에는 필요하지 않습니다.

`src/config/env.ts`는 `.env`를 읽고 기본값과 숫자·목록 변환만 적용합니다.
값의 유효성은 검사하지 않으므로 `.env.example`을 기준으로 직접 설정합니다.

## 명령어

| 명령어                   | 설명                                  |
| ------------------------ | ------------------------------------- |
| `npm run dev`            | 개발 서버 (tsx watch)                 |
| `npm run build`          | Prisma Client 생성 + `dist/`로 컴파일 |
| `npm start`              | 빌드 결과 실행                        |
| `npm run lint`           | ESLint 검사 (`lint:fix`로 자동 수정)  |
| `npm run typecheck`      | 타입 검사                             |
| `npm run knip`           | 사용하지 않는 파일·export·의존성 검사 |
| `npm run format:check`   | Prettier 검사 (`format`으로 수정)     |
| `npm test`               | 테스트 실행 (Vitest)                  |
| `npm run prisma:migrate` | 마이그레이션 생성 및 로컬 DB 적용     |
| `npm run prisma:deploy`  | 기존 마이그레이션을 DB에 적용         |
| `npm run prisma:seed`    | 빈 개발 DB에 시드 데이터 추가         |
| `npm run prisma:studio`  | Prisma Studio                         |

`npm test`는 `TEST_DATABASE_URL`의 DB에 마이그레이션을 적용한 뒤 실행하고, 테스트마다 모든 행을 지웁니다.
개발 DB와 다른 DB를 미리 만들어 둡니다 (예: `createdb moving_test`).

시드 데이터의 날짜는 실행한 날을 기준으로 만듭니다. 이미 시드 데이터가 있는 DB에서는 실패하므로, 다시 채울 때는 `npx prisma migrate reset`으로 DB를 비운 뒤 `npm run prisma:seed`를 실행합니다.

## 구조

`routes → controllers → services` 순서로 호출합니다.

초기 설계 문서: [ERD](docs/db/erd.ko.md) · [OpenAPI 초안](docs/api/openapi.ko.yaml). DB 정의는 `prisma/schema.prisma`와 `prisma/migrations/`를 기준으로 합니다. OpenAPI 문서는 로컬 `http://localhost:4000/api/docs/` 또는 [dev 서버 Swagger UI](https://api.dev.helpisa.com/api/docs/)에서 볼 수 있고, 원본 YAML은 `GET /api/openapi.yaml`에서 받을 수 있습니다. 문서에 정의된 API 중 아직 구현되지 않은 경로가 있습니다.

```text
src/
  app.ts            Express 앱과 공통 미들웨어
  server.ts         서버 실행 진입점
  config/           환경 변수와 기본값
  errors/           AppError, 공통 에러 코드와 상태
  routes/           URL → controller 연결 (/api 아래)
  controllers/      요청/응답 처리
  services/         비즈니스 규칙, Prisma 쿼리, 트랜잭션
  middlewares/      인증, 에러 처리 등
  validators/       요청 검증 스키마
  lib/              Prisma 등 외부 클라이언트
  utils/            공통 유틸
  types/            Express 타입 확장 (req.user)
  generated/        Prisma Client (생성물, 커밋 안 함)
tests/              Vitest + supertest 테스트
```

## 실행 및 상태 확인

- `GET /api/health`: 프로세스 생존 확인. DB 연결 없이 200을 반환합니다.
- `GET /api/ready`: DB에 `SELECT 1`을 실행합니다. DB 오류 시 503을 반환합니다. 배포 직후 확인용입니다.
- `GET /api/docs/`: Swagger UI에서 OpenAPI 초안을 보여줍니다.
- `GET /api/openapi.yaml`: OpenAPI 초안 파일을 제공합니다. 실행 시 프로젝트 루트의 `docs/api/openapi.ko.yaml` 파일이 필요합니다.
- DB 연결은 드라이버 기본 설정을 사용합니다. 연결 및 쿼리 대기 시간에 별도 제한을 설정하지 않습니다 (`src/lib/prisma.ts`).
- `SIGINT` / `SIGTERM`: 새 연결 수락 중단 → 진행 중인 HTTP 요청 완료 → Prisma 연결 해제 순으로 종료합니다. 10초를 넘기면 실패 상태로 종료합니다. PM2/Nginx의 종료 유예 시간도 이에 맞춰 설정합니다.
- `TRUST_PROXY`는 실제 Nginx / 로드밸런서 경로와 맞춰야 합니다. 앱에 직접 접근 가능한 배포에서 무조건 `1`로 설정하지 않습니다. 운영에서는 `HOST=127.0.0.1`로 앱을 Nginx 뒤에만 노출합니다.
- 운영 실행은 `NODE_ENV=production npm start`를 사용합니다.

## 배포

| 환경 | 브랜치    | 프론트                  | API                             |
| ---- | --------- | ----------------------- | ------------------------------- |
| dev  | `develop` | https://dev.helpisa.com | https://api.dev.helpisa.com/api |
| prod | `main`    | https://helpisa.com     | https://api.helpisa.com/api     |

- 머지 후 CI가 통과하면 자동으로 배포됩니다. 진행 상황은 Actions 탭의 `Deploy`에서 확인합니다.
- 스키마를 바꾸면 `npm run prisma:migrate`로 만든 마이그레이션 파일을 같은 PR에 커밋합니다. CI가 검사합니다.

## 협업 규칙

브랜치 전략, 커밋 형식, PR 규칙은 [CONTRIBUTING.md](https://github.com/fs14-team3/.github/blob/main/CONTRIBUTING.md)를 따릅니다.
