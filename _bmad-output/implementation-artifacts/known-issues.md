# Known Issues

_No open issues._

## Resolved

### @mega-jira/shared runtime module resolution

**Status:** Resolved (2026-04-10)
**Fix:** Added `build` scripts to `packages/shared` and `packages/ui`. Updated `main`/`types` fields to point to `dist/` output. Changed shared tsconfig to `module: "commonjs"` for NestJS CJS compatibility. Turborepo `^build` dependency ensures packages build before consumers.
