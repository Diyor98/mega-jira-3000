# Story 1.3: User Login & Session Management

Status: done

## Story

As a **registered user**,
I want to log in with my email and password,
so that I can access my projects securely.

## Acceptance Criteria

1. `POST /api/v1/auth/login` accepts `{ email, password }` and returns JWT access token + refresh token in httpOnly cookies
2. Access token expires after 15 minutes; refresh token after 7 days
3. `POST /api/v1/auth/refresh` silently refreshes the access token using the refresh token cookie
4. Failed login returns generic "Invalid email or password" (no user enumeration)
5. After 5 failed attempts in 15 minutes for the same email, return 429 "Too many login attempts. Try again later."
6. Failed login attempts are logged with IP and timestamp (never log passwords)
7. Login page at `/login` with email and password fields; redirects to `/` on success
8. `POST /api/v1/auth/logout` clears both cookies
9. API returns 401 for requests with missing/expired access token (except public endpoints: register, login, refresh, health)

## Tasks / Subtasks

- [x] Task 1: Install JWT dependencies and create auth schemas (AC: #1, #2)
  - [x] Install `@nestjs/jwt` and `@nestjs/passport` in `apps/api`
  - [x] Install `passport`, `passport-jwt`, `cookie-parser`, `@types/cookie-parser` in `apps/api`
  - [x] Create `packages/shared/src/schemas/login.schema.ts`:
    - `loginSchema`: Zod schema with email (valid email) + password (string, min 1)
    - Export `LoginInput` type
  - [x] Export `loginSchema` and `LoginInput` from `packages/shared/src/index.ts`
  - [x] Create `apps/api/src/modules/auth/dto/login.dto.ts` — re-export from `@mega-jira/shared` (pattern from Story 1.2)
  - [x] Rebuild `@mega-jira/shared` (`pnpm --filter @mega-jira/shared build`)

- [x] Task 2: Create JWT token service (AC: #1, #2, #3)
  - [x] Create `apps/api/src/modules/auth/token.service.ts`:
    - Inject `JwtService` from `@nestjs/jwt`
    - `generateTokens(userId: string, email: string, role: string)`: returns `{ accessToken, refreshToken }`
    - Access token payload: `{ sub: userId, email, role }`, expires per `JWT_ACCESS_EXPIRY` from env
    - Refresh token payload: `{ sub: userId, type: 'refresh' }`, expires per `JWT_REFRESH_EXPIRY` from env
  - [x] Create `apps/api/src/modules/auth/strategies/jwt.strategy.ts`:
    - Extends `PassportStrategy(Strategy, 'jwt')`
    - Extracts token from cookie named `access_token`
    - Validates payload and returns `{ userId: payload.sub, email: payload.email, role: payload.role }`
  - [x] Create `apps/api/src/modules/auth/guards/jwt-auth.guard.ts`:
    - Extends `AuthGuard('jwt')`
    - Returns 401 UnauthorizedException on invalid/missing token

- [x] Task 3: Implement login endpoint with rate limiting (AC: #1, #4, #5, #6)
  - [x] Create `apps/api/src/database/schema/login-attempts.ts`:
    - `loginAttempts` table: `id` UUID PK, `email` varchar(255), `ipAddress` varchar(45), `success` boolean, `createdAt` timestamptz
    - Index on `(email, created_at)` for rate limit queries
  - [x] Generate migration: `pnpm drizzle-kit generate`
  - [x] Add `login(dto)` method to `AuthService`:
    - Normalize email: `trim().toLowerCase()` (pattern from Story 1.2)
    - Check rate limit: count failed attempts for this email in last `LOGIN_LOCKOUT_MINUTES` (15min)
    - If >= `MAX_LOGIN_ATTEMPTS` (5): throw `TooManyRequestsException` (429)
    - Find user by email → if not found, throw `UnauthorizedException('Invalid email or password')`
    - Compare password with bcrypt → if mismatch, log failed attempt, throw `UnauthorizedException('Invalid email or password')`
    - Log successful attempt
    - Generate tokens via TokenService
    - Audit log: `[AUDIT] user.login | userId={id} | email={email}`
    - Return tokens + user data (without passwordHash)
  - [x] Add `POST /api/v1/auth/login` to `AuthController`:
    - Call `authService.login(body, request.ip)`
    - Set `access_token` and `refresh_token` as httpOnly, secure, sameSite=lax cookies
    - Return `{ id, email, role }`

- [x] Task 4: Implement refresh and logout endpoints (AC: #3, #8)
  - [x] Add `refresh(refreshToken)` method to `AuthService`:
    - Verify refresh token with JwtService
    - Check payload `type === 'refresh'`
    - Look up user by `payload.sub` → if not found, throw UnauthorizedException
    - Generate new token pair
    - Return new tokens
  - [x] Add `POST /api/v1/auth/refresh` to `AuthController`:
    - Extract `refresh_token` from cookies
    - Call `authService.refresh(refreshToken)`
    - Set new cookies
    - Return `{ id, email, role }`
  - [x] Add `POST /api/v1/auth/logout` to `AuthController`:
    - Clear both `access_token` and `refresh_token` cookies
    - Return `{ message: 'Logged out' }`

- [x] Task 5: Apply JWT guard globally with public route exclusions (AC: #9)
  - [x] Create `apps/api/src/modules/auth/decorators/public.decorator.ts`:
    - `@Public()` decorator using `SetMetadata('isPublic', true)`
  - [x] Update `JwtAuthGuard` to check for `isPublic` metadata → skip auth if true
  - [x] Register `JwtAuthGuard` as global guard in `AuthModule` (via `APP_GUARD` provider)
  - [x] Apply `@Public()` to: health endpoint, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`
  - [x] Update `AuthModule` to import `JwtModule.registerAsync` with env-based secret and `PassportModule`

- [x] Task 6: Create login UI page (AC: #7)
  - [x] Create `apps/web/src/app/login/page.tsx`:
    - Form with email input, password input, submit button
    - Client-side validation using shared `loginSchema`
    - On submit: call `POST /api/v1/auth/login` via apiClient
    - On success: redirect to `/`
    - On 401: show "Invalid email or password"
    - On 429: show "Too many login attempts. Try again later."
  - [x] Style with Tailwind using design tokens (same pattern as register page)
  - [x] Add "Don't have an account?" link to `/register`

- [x] Task 7: Wire up cookie parser in NestJS bootstrap (AC: #1, #3)
  - [x] Add `app.use(cookieParser())` in `apps/api/src/main.ts`
  - [x] Ensure `cookie-parser` is imported and configured before routes

## Dev Notes

### Architecture Compliance

- **JWT Strategy:** Custom JWT using `@nestjs/jwt` + `@nestjs/passport` — NOT third-party OAuth
- **Token Storage:** httpOnly cookies — NEVER localStorage. Cookie names: `access_token`, `refresh_token`
- **Token Expiry:** 15min access (from `JWT_ACCESS_EXPIRY` env), 7-day refresh (from `JWT_REFRESH_EXPIRY` env)
- **Secret:** `JWT_SECRET` env var (already validated by `validateEnv` in bootstrap)
- **Password Verification:** bcrypt `compare()` against stored hash — same library as Story 1.2
- **Rate Limiting:** Application-level per-email tracking via `login_attempts` table — NOT `@nestjs/throttler` (need per-email, not per-IP)
- **API format:** All responses wrapped in `{ data: T }` by TransformInterceptor. Errors use `{ error, message, code }`.
- **Validation:** Zod schemas in `packages/shared`, re-exported via DTO files in API (pattern from Story 1.2)

### Naming Conventions (from Story 1.1/1.2)

- Files: `kebab-case.ts`
- DB tables: `snake_case` plural → `login_attempts`
- DB columns: `snake_case` → `ip_address`, `created_at`
- API endpoints: `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`
- NestJS classes: `PascalCase` + suffix → `TokenService`, `JwtStrategy`, `JwtAuthGuard`

### Cookie Configuration

```typescript
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

// Set cookies:
response.cookie('access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
response.cookie('refresh_token', refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });

// Clear cookies:
response.clearCookie('access_token', COOKIE_OPTIONS);
response.clearCookie('refresh_token', COOKIE_OPTIONS);
```

### Existing Constants (packages/shared/src/constants/limits.ts)

Already defined — DO NOT redefine:
- `JWT_ACCESS_EXPIRY = '15m'`
- `JWT_REFRESH_EXPIRY = '7d'`
- `MAX_LOGIN_ATTEMPTS = 5`
- `LOGIN_LOCKOUT_MINUTES = 15`

### Existing Env Validation (packages/shared/src/schemas/env.schema.ts)

Already validates: `JWT_SECRET` (min 16 chars), `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `REDIS_URL`

### Previous Story Intelligence (Story 1.2)

- **Email normalization:** Always `trim().toLowerCase()` before any operation (review fix from Story 1.2)
- **TOCTOU handling:** Catch PG error code `23505` for unique constraint violations (Story 1.2 pattern)
- **DTO re-export pattern:** DTO files re-export from `@mega-jira/shared` — no schema duplication
- **Audit logging:** Use `this.logger.log('[AUDIT] action | context')` pattern from AuthService
- **Response safety:** Use `.returning()` with explicit field selection — never return `passwordHash`
- **Test pattern:** Mock DB with chainable `select/insert` helpers, mock bcrypt
- **Shared package build:** Run `pnpm --filter @mega-jira/shared build` after modifying shared schemas

### What NOT To Do

- Do NOT implement RBAC role checking — that's Epic 8
- Do NOT create forgot-password flow — not in MVP scope
- Do NOT store tokens in localStorage — httpOnly cookies only
- Do NOT log passwords in failed attempt records — log IP + timestamp only
- Do NOT use `@nestjs/throttler` for login rate limiting — need per-email tracking, not per-IP
- Do NOT create a separate refresh token table — JWT is stateless, verify by signature
- Do NOT duplicate Zod schemas — import from `@mega-jira/shared`
- Do NOT use argon2 — architecture specifies bcrypt
- Do NOT return passwordHash in any response

### Project Structure After This Story

New/modified files:
```
apps/api/
├── src/
│   ├── database/
│   │   └── schema/
│   │       └── login-attempts.ts       # NEW — rate limiting table
│   ├── modules/
│   │   └── auth/
│   │       ├── auth.service.ts         # MODIFIED — add login(), refresh()
│   │       ├── auth.controller.ts      # MODIFIED — add login, refresh, logout endpoints
│   │       ├── auth.module.ts          # MODIFIED — import JwtModule, PassportModule, register guard
│   │       ├── token.service.ts        # NEW — JWT generation
│   │       ├── strategies/
│   │       │   └── jwt.strategy.ts     # NEW — Passport JWT strategy
│   │       ├── guards/
│   │       │   └── jwt-auth.guard.ts   # NEW — JWT auth guard
│   │       ├── decorators/
│   │       │   └── public.decorator.ts # NEW — @Public() decorator
│   │       └── dto/
│   │           └── login.dto.ts        # NEW — re-export from shared
│   └── main.ts                         # MODIFIED — add cookie-parser
apps/web/src/app/
│   └── login/
│       └── page.tsx                    # NEW — login form
packages/shared/src/
├── schemas/
│   └── login.schema.ts                # NEW — login Zod schema
└── index.ts                           # MODIFIED — export login schema
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture — Drizzle ORM]
- [Source: _bmad-output/planning-artifacts/prd.md#FR42, NFR8, NFR9, NFR10]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3]
- [Source: _bmad-output/implementation-artifacts/1-2-user-registration.md#Review Findings]

## Testing Requirements

- `POST /api/v1/auth/login` with valid credentials returns 200 with `{ data: { id, email, role } }` and sets httpOnly cookies
- `POST /api/v1/auth/login` with wrong password returns 401 `{ error: "Unauthorized", message: "Invalid email or password", code: 401 }`
- `POST /api/v1/auth/login` with non-existent email returns 401 (same generic error — no enumeration)
- `POST /api/v1/auth/login` after 5 failed attempts returns 429 `{ error: "TooManyRequests", message: "Too many login attempts. Try again later.", code: 429 }`
- Failed login attempt is recorded in `login_attempts` table with email, IP, success=false, timestamp
- Access token cookie has httpOnly=true, maxAge=15min
- Refresh token cookie has httpOnly=true, maxAge=7days
- `POST /api/v1/auth/refresh` with valid refresh cookie returns 200 and sets new cookies
- `POST /api/v1/auth/refresh` with expired/invalid refresh cookie returns 401
- `POST /api/v1/auth/logout` clears both cookies
- Protected endpoint without token returns 401
- Protected endpoint with valid token returns expected data
- Public endpoints (register, login, refresh, health) work without token
- Login page renders at `/login` with email and password fields
- Successful login redirects to `/`
- Login form shows error messages for 401 and 429 responses

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Installed @nestjs/jwt, @nestjs/passport, passport, passport-jwt, cookie-parser in API
- Created login Zod schema in packages/shared with DTO re-export pattern from Story 1.2
- Created TokenService for JWT access/refresh token generation (15m/7d expiry)
- Created JwtStrategy (Passport) extracting tokens from httpOnly cookies
- Created JwtAuthGuard with @Public() decorator for public route exclusions
- Created login_attempts table with index for rate-limit queries
- Implemented login endpoint: email normalization, rate limiting (5 attempts/15min), bcrypt verify, audit logging
- Implemented refresh endpoint: verify refresh token type, look up user, issue new token pair
- Implemented logout endpoint: clears both cookies
- Applied global JWT guard with @Public() on health, register, login, refresh endpoints
- Created login UI at /login with shared schema validation, 401/429 error handling
- Added cookie-parser middleware in NestJS bootstrap
- 32 tests passing across 4 test suites (TokenService: 4, AuthService: 16, AuthController: 5, RegisterDto: 7)

### File List

- apps/api/src/modules/auth/token.service.ts (NEW)
- apps/api/src/modules/auth/token.service.spec.ts (NEW — unit tests)
- apps/api/src/modules/auth/strategies/jwt.strategy.ts (NEW)
- apps/api/src/modules/auth/guards/jwt-auth.guard.ts (NEW)
- apps/api/src/modules/auth/decorators/public.decorator.ts (NEW)
- apps/api/src/modules/auth/dto/login.dto.ts (NEW)
- apps/api/src/database/schema/login-attempts.ts (NEW)
- apps/api/src/database/migrations/0001_lucky_stardust.sql (NEW — migration)
- apps/api/src/modules/auth/auth.service.ts (MODIFIED — added login(), refresh(), recordLoginAttempt())
- apps/api/src/modules/auth/auth.service.spec.ts (MODIFIED — added login/refresh tests)
- apps/api/src/modules/auth/auth.controller.ts (MODIFIED — added login, refresh, logout endpoints, @Public())
- apps/api/src/modules/auth/auth.controller.spec.ts (MODIFIED — added login/refresh/logout tests)
- apps/api/src/modules/auth/auth.module.ts (MODIFIED — added JwtModule, PassportModule, TokenService, JwtStrategy, JwtAuthGuard)
- apps/api/src/database/db.ts (MODIFIED — added login-attempts schema import)
- apps/api/src/main.ts (MODIFIED — added cookie-parser)
- apps/api/src/health/health.controller.ts (MODIFIED — added @Public())
- apps/api/package.json (MODIFIED — added JWT/passport/cookie dependencies)
- apps/web/src/app/login/page.tsx (NEW)
- packages/shared/src/schemas/login.schema.ts (NEW)
- packages/shared/src/index.ts (MODIFIED — export loginSchema, LoginInput)

### Review Findings

- [x] [Review][Decision] D1: Successful logins don't reset the failed attempt counter — RESOLVED: keep current behavior (Option 1). More secure against credential stuffing; 15-min window is short enough for acceptable UX.
- [x] [Review][Patch] P1: TokenService uses hardcoded '15m'/'7d' instead of shared constants JWT_ACCESS_EXPIRY/JWT_REFRESH_EXPIRY — fixed, now imports from @mega-jira/shared
- [x] [Review][Patch] P2: JwtStrategy.validate() doesn't reject refresh tokens used as access tokens — fixed, returns null for refresh type
- [x] [Review][Patch] P3: Missing SECURITY log for user-not-found failed login path — fixed, added logger.warn
- [x] [Review][Patch] P4: refresh() returns different error messages for different failure modes — fixed, unified to "Invalid refresh token"
- [x] [Review][Patch] P5: verifyToken() has no algorithm restriction — fixed, added { algorithms: ['HS256'] }
- [x] [Review][Patch] P6: Test gap — auth.controller.spec login test now asserts cookie names and httpOnly
- [x] [Review][Patch] P7: Test gap — auth.controller.spec logout test now asserts cookie names
- [x] [Review][Patch] P8: Test gap — auth.service.spec now asserts recordLoginAttempt called for user-not-found
- [x] [Review][Patch] P9: Test anti-pattern — replaced fail() with rejects.toMatchObject
- [x] [Review][Defer] W1: Refresh token has no revocation mechanism — stolen tokens valid for 7 days — deferred, story spec says "JWT is stateless, verify by signature"
- [x] [Review][Defer] W2: Rate limit race condition — concurrent requests can bypass 5-attempt limit via check-then-act without DB lock — deferred, MVP acceptable
- [x] [Review][Defer] W3: Rate limiting is per-email only, no per-IP throttle — deferred, by design per AC 5 ("for the same email")
- [x] [Review][Defer] W4: User enumeration via timing side-channel — user-not-found skips bcrypt.compare making it faster — deferred, security hardening
- [x] [Review][Defer] W5: req.ip untrusted without app.set('trust proxy') — logs proxy IP, not client IP in production — deferred, deployment config
- [x] [Review][Defer] W6: login_attempts table has no TTL/cleanup mechanism — unbounded growth — deferred, operational task
- [x] [Review][Defer] W7: Unicode/IDN homograph emails not normalized — visually identical emails treated as distinct — deferred, security hardening
- [x] [Review][Defer] W8: Cookie secure flag tied to NODE_ENV==='production' — staging HTTPS gets insecure cookies — deferred, deployment config
- [x] [Review][Defer] W9: No global ValidationPipe — raw bodies reach service; Zod in service is the chosen validation pattern — deferred, architectural choice

## Change Log

- 2026-04-10: Implemented all Story 1.3 tasks — JWT auth, login/refresh/logout endpoints, rate limiting, login UI
- 2026-04-10: Story marked for review — all ACs satisfied, 32 tests passing
- 2026-04-10: Code review complete — 1 decision resolved, 9 patches applied, 9 deferred, 12 dismissed. All 32 tests passing. Story marked done.
