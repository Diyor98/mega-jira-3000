import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { and, eq, lt, desc, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { users } from '../../database/schema/users';
import { auditLog } from '../../database/schema/audit-log';

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed?.createdAt !== 'string' ||
      typeof parsed?.id !== 'string'
    ) {
      throw new Error('bad cursor shape');
    }
    return parsed;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

@Controller('api/v1/projects/:projectKey/audit-log')
export class AuditController {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('projectKey') projectKey: string,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
    @Req() req: Request,
  ) {
    const userId = (req as unknown as { user: { userId: string } }).user.userId;

    const [project] = await this.db
      .select({ id: projects.id, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);
    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 100);
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

    const conds = [eq(auditLog.projectId, project.id)];
    if (cursor) {
      conds.push(
        sql`(${auditLog.createdAt}, ${auditLog.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`,
      );
    }

    const rows = await this.db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        actorId: auditLog.actorId,
        actorEmail: sql<string>`coalesce(${users.email}, '[deleted user]')`,
        beforeValue: auditLog.beforeValue,
        afterValue: auditLog.afterValue,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(and(...conds))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    let page = rows;
    if (rows.length > limit) {
      page = rows.slice(0, limit);
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      });
    }
    return { rows: page, nextCursor };
  }
}
