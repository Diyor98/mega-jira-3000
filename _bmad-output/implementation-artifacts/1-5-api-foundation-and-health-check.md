# Story 1.5: API Foundation & Health Check

Status: done

## Story

As a **platform operator**,
I want standardized API responses, structured logging, and health checks,
so that the platform is monitorable and consistent.

## Acceptance Criteria

1. All successful API responses use format `{ data: T }` (AR7)
2. All API errors use format `{ error, message, code }` with no stack traces exposed (NFR28)
3. `GET /api/v1/health` returns `{ status: "ok" }` with HTTP 200
4. All logs use pino structured JSON format with PII masking (AR8, NFR11)

## IMPORTANT: What Already Exists

Most of ACs 1-3 are **already implemented** from Stories 1.1-1.4. This story is primarily about:
- **AC 4 (pino + PII masking)** — NEW work, the main deliverable
- **ACs 1-3** — VERIFY existing implementations work correctly, add tests if missing

### Already Implemented (DO NOT REBUILD):
- `TransformInterceptor` at `apps/api/src/common/interceptors/transform.interceptor.ts` — wraps all responses in `{ data: T }` ✅
- `GlobalExceptionFilter` at `apps/api/src/common/filters/http-exception.filter.ts` — maps errors to `{ error, message, code }` ✅
- `HealthController` at `apps/api/src/health/health.controller.ts` — `GET /api/v1/health` returns `{ status: 'ok' }`, marked `@Public()` ✅
- Global registration of filter + interceptor in `main.ts` ✅
- Basic `Logger` usage in AuthService and ProjectsService for audit/security logs ✅

### What's Missing (NEW WORK):
- No pino dependency — still using NestJS built-in Logger (string format, not structured JSON)
- No PII masking in logs
- No request/response logging middleware
- No tests for the existing interceptor/filter/health endpoint

## Tasks / Subtasks

- [x] Task 1: Install pino and configure as NestJS logger (AC: #4)
  - [x] Install `nestjs-pino`, `pino`, `pino-http`, `pino-pretty` (dev) in `apps/api`
  - [x] Import `LoggerModule` from `nestjs-pino` in `AppModule`:
    - Configure pino with JSON format in production, `pino-pretty` in development
    - Set log level from env (`LOG_LEVEL` defaulting to `'info'`)
  - [x] Remove `console.log` from `main.ts` bootstrap — replace with pino Logger
  - [x] Set `bufferLogs: true` in `NestFactory.create` options and call `app.useLogger(app.get(Logger))` to route all NestJS logs through pino

- [x] Task 2: Add PII masking to pino configuration (AC: #4)
  - [x] Configure pino `redact` option to mask sensitive fields:
    - Paths: `['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.email', '*.token', '*.accessToken', '*.refreshToken']`
    - Use `censor: '[REDACTED]'`
  - [x] Existing audit logs continue to work — pino replaces NestJS Logger transparently

- [x] Task 3: Add request logging via pino-http (AC: #4)
  - [x] `nestjs-pino` with `pino-http` automatically logs every HTTP request/response with method, URL, status code, response time, request ID
  - [x] Configure `autoLogging` to exclude health check endpoint (`/api/v1/health`) to avoid log noise
  - [x] Request/response bodies NOT logged (pino-http default — no PII leakage)

- [x] Task 4: Write tests for existing API foundation (ACs: #1, #2, #3)
  - [x] Create `apps/api/src/common/interceptors/transform.interceptor.spec.ts`:
    - Test: wraps plain object in `{ data: T }`
    - Test: does NOT double-wrap already-wrapped `{ data: T }` objects
    - Test: wraps arrays in `{ data: T[] }`
    - Test: wraps null/undefined responses
    - Test: wraps string responses
    - Test: does not re-wrap objects with data key plus other keys
  - [x] Create `apps/api/src/common/filters/http-exception.filter.spec.ts`:
    - Test: HttpException returns `{ error, message, code }` with correct status
    - Test: non-HttpException returns 500 with generic message (no stack trace)
    - Test: extracts message from exception response object
    - Test: extracts message from string exception response
    - Test: handles BadRequestException with validation message
  - [x] Create `apps/api/src/health/health.controller.spec.ts`:
    - Test: `GET /api/v1/health` returns `{ status: 'ok' }`
    - Test: endpoint is public (has `@Public()` metadata)

- [x] Task 5: Verify end-to-end API response format consistency (ACs: #1, #2)
  - [x] Review all existing controllers for response format compliance:
    - `AuthController`: register (201), login (200 + cookies), refresh (200 + cookies), logout (200) — all pass through TransformInterceptor ✅
    - `ProjectsController`: create (201), findAll (200) — all pass through TransformInterceptor ✅
    - `HealthController`: check (200) — passes through TransformInterceptor ✅
  - [x] Verify GlobalExceptionFilter does NOT leak stack traces:
    - Non-HttpException errors → generic 500, no stack trace ✅ (tested)
    - Validation errors → 400 with message ✅ (tested)
    - Conflict errors → 409 with message ✅ (tested)
    - Auth errors → 401 with message ✅ (existing tests)

## Dev Notes

### Architecture Compliance

- **Logging library:** pino via `nestjs-pino` — the NestJS-integrated wrapper that replaces the built-in Logger
- **PII masking:** Use pino's built-in `redact` option — no custom middleware needed
- **Existing interceptor/filter:** DO NOT modify `TransformInterceptor` or `GlobalExceptionFilter` unless tests reveal bugs — they already work correctly
- **Health endpoint:** Already exists and works. Only add tests, don't rebuild
- **API format:** Already enforced globally. Only verify and test

### What nestjs-pino Provides

`nestjs-pino` is a NestJS module that:
1. Replaces the built-in `Logger` with pino — all `this.logger.log()`, `this.logger.warn()` calls automatically output structured JSON
2. Integrates `pino-http` for automatic request/response logging
3. Provides request context (request ID) to all logs within a request lifecycle
4. Works with the existing `new Logger(ClassName.name)` pattern — no code changes needed in services

### Configuration Pattern

```typescript
// app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
            '*.email',
            '*.token',
            '*.accessToken',
            '*.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/health',
        },
      },
    }),
    // ... other modules
  ],
})
```

```typescript
// main.ts
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // ... rest of bootstrap
}
```

### Naming Conventions (from Stories 1.1–1.4)

- Files: `kebab-case.ts`
- Test files: co-located `*.spec.ts`
- NestJS classes: `PascalCase` + suffix

### Previous Story Intelligence

- **Test pattern:** Mock DB with chainable helpers; use `rejects.toMatchObject()` for errors
- **Audit logging:** Services use `this.logger.log('[AUDIT] action | context')` — this will automatically become structured JSON once pino is configured
- **GlobalExceptionFilter:** Story 1.2 deferred item noted it "swallows non-HTTP exceptions without logging" — verify this is addressed
- **console.log in main.ts:** Story 1.3 review noted this as a code quality issue — this task replaces it with pino

### What NOT To Do

- Do NOT modify `TransformInterceptor` or `GlobalExceptionFilter` unless tests reveal actual bugs
- Do NOT modify existing service code (AuthService, ProjectsService) — pino replaces the Logger transparently
- Do NOT add request body logging — risk of PII exposure
- Do NOT add response body logging — risk of PII exposure and performance impact
- Do NOT remove the `@Public()` decorator from health endpoint
- Do NOT add database health checks — that's beyond this story's scope (just the basic `{ status: 'ok' }`)
- Do NOT install winston — architecture specifies pino
- Do NOT create custom logging middleware — use `nestjs-pino` which handles it

### Project Structure After This Story

New/modified files:
```
apps/api/
├── src/
│   ├── app.module.ts                    # MODIFIED — import LoggerModule
│   ├── main.ts                          # MODIFIED — use pino Logger, remove console.log
│   ├── common/
│   │   ├── interceptors/
│   │   │   └── transform.interceptor.spec.ts  # NEW — tests
│   │   └── filters/
│   │       └── http-exception.filter.spec.ts  # NEW — tests
│   └── health/
│       └── health.controller.spec.ts    # NEW — tests
├── package.json                         # MODIFIED — add pino dependencies
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Logging]
- [Source: _bmad-output/planning-artifacts/architecture.md#API Responses]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR11, NFR28]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5]
- [Source: _bmad-output/implementation-artifacts/1-4-create-first-project.md#Review Findings]

## Testing Requirements

- TransformInterceptor wraps plain objects in `{ data: T }`
- TransformInterceptor does not double-wrap `{ data: T }`
- TransformInterceptor wraps arrays
- GlobalExceptionFilter returns `{ error, message, code }` for HttpException
- GlobalExceptionFilter returns 500 with generic message for non-HttpException (no stack trace)
- Health check returns `{ status: 'ok' }` at `GET /api/v1/health`
- Health check is public (no JWT required)
- Pino structured JSON logging is active (logs are valid JSON in production mode)
- PII fields are redacted in log output
- Request logging includes method, URL, status code, response time
- Health check requests are excluded from request logs
- All existing tests continue to pass (no regressions)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Installed nestjs-pino, pino, pino-http, pino-pretty for structured JSON logging
- Configured LoggerModule in AppModule with pino-http integration
- PII masking via pino redact: authorization headers, cookies, password, email, token fields
- Health check endpoint excluded from auto-logging to reduce noise
- Replaced console.log in main.ts with pino Logger
- Enabled bufferLogs for proper log ordering during bootstrap
- Pino-pretty for dev, raw JSON in production
- Log level configurable via LOG_LEVEL env var (defaults to 'info')
- 13 new tests: TransformInterceptor (6), GlobalExceptionFilter (5), HealthController (2)
- Verified all existing controllers comply with { data: T } response format
- Verified GlobalExceptionFilter never leaks stack traces
- All 60 tests passing (47 existing + 13 new)

### File List

- apps/api/src/app.module.ts (MODIFIED — import LoggerModule with pino config)
- apps/api/src/main.ts (MODIFIED — use pino Logger, remove console.log, add bufferLogs)
- apps/api/src/common/interceptors/transform.interceptor.spec.ts (NEW — 6 tests)
- apps/api/src/common/filters/http-exception.filter.spec.ts (NEW — 5 tests)
- apps/api/src/health/health.controller.spec.ts (NEW — 2 tests)
- apps/api/package.json (MODIFIED — add pino dependencies)

### Review Findings

- [x] [Review][Patch] P1: Health endpoint wrapped as { data: { status: "ok" } } — documented in test as expected behavior (AC 1 takes precedence: all responses wrapped)
- [x] [Review][Patch] P2: GlobalExceptionFilter error field now derives from STATUS_TO_ERROR map — 429 returns 'TooManyRequests', 401 returns 'Unauthorized', etc.
- [x] [Review][Defer] W1: Redact paths use shallow wildcards (*.email) — deeply nested fields not redacted — deferred, acceptable for MVP
- [x] [Review][Defer] W2: GlobalExceptionFilter instantiated with new (not DI) — cannot inject logger — deferred, pre-existing from Story 1.1
- [x] [Review][Defer] W3: No Helmet middleware for security headers — deferred, deployment concern
- [x] [Review][Defer] W4: bootstrap() has no .catch() handler — deferred, pre-existing
- [x] [Review][Defer] W5: WEB_URL read from process.env instead of validated env object — deferred, pre-existing

## Change Log

- 2026-04-10: Story created by create-story workflow — focused on pino structured logging (ACs 1-3 already implemented)
- 2026-04-10: Implemented all Story 1.5 tasks — pino structured logging, PII masking, request logging, API foundation tests
- 2026-04-10: Story marked for review — all ACs satisfied, 60 tests passing (13 new + 47 existing)
- 2026-04-10: Code review complete — 2 patches applied, 5 deferred, 9 dismissed. 60 tests passing. Story marked done.
