import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  Req,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataLifecycleService } from './data-lifecycle.service';

/**
 * Parse `ADMIN_USER_IDS` (comma-separated UUIDs) into a frozen Set at module
 * load. The endpoint is DISABLED-by-default — an empty / missing env var
 * means no caller passes the gate, which is the safe default for a
 * destructive system-wide operation. Epic 8 RBAC will replace this with a
 * real admin-role check.
 *
 * Previously gated by "owns at least one project anywhere" which allowed
 * any authenticated user to trigger a global destructive purge. See the
 * 7.2 code review finding H1.
 */
function parseAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(ids);
}

const ADMIN_ALLOWLIST = parseAdminAllowlist();

@Controller('api/v1/admin/lifecycle')
export class LifecycleController {
  private readonly logger = new Logger(LifecycleController.name);

  constructor(private readonly service: DataLifecycleService) {}

  @Post('purge-now')
  @HttpCode(HttpStatus.OK)
  async purgeNow(@Req() req: Request) {
    const userId = (req as unknown as { user: { userId: string } }).user.userId;
    if (!ADMIN_ALLOWLIST.has(userId)) {
      throw new ForbiddenException('Admin-only endpoint');
    }
    // Explicit audit line — a manual destructive admin action deserves a
    // forensic trail even when the call succeeds. (Review L1.)
    this.logger.warn(
      `[AUDIT] lifecycle.purgeNow.invoked | userId=${userId}`,
    );
    return this.service.purgeExpired();
  }
}
