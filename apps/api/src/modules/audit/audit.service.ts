import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { auditLog } from '../../database/schema/audit-log';

export type AuditEntityType =
  | 'issue'
  | 'comment'
  | 'attachment'
  | 'workflow_status'
  | 'workflow_rule'
  | 'project'
  | 'project_member'
  | 'filter_preset';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'moved'
  | 'renamed'
  | 'reordered'
  | 'bulk_moved';

export interface AuditEntry {
  projectId: string | null;
  actorId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

// Defense-in-depth: strip obviously sensitive fields from snapshots before
// writing them to audit_log. Services should not pass these in the first
// place — this is a belt-and-suspenders guard.
const SENSITIVE_KEY_REGEX = /token|secret|password/i;

export function redact<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Append-only audit insert. Fail-soft: a failure here must NOT propagate
   * to the caller. Rationale: losing a single audit row is bad, killing the
   * caller's request because the audit insert failed is worse.
   *
   * Intentionally runs on `this.db`, NOT any passed-in tx — decouples the
   * audit row from the caller's transaction state (Story 6.3 lesson: a
   * fail-soft service inside an aborted tx leaves the Postgres session in
   * ERROR).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        projectId: entry.projectId,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        beforeValue: entry.before ? redact(entry.before) : null,
        afterValue: entry.after ? redact(entry.after) : null,
        metadata: entry.metadata ?? null,
      });
    } catch (e) {
      const err = e as Error;
      this.logger.warn(
        `[AUDIT] auditLog.insertFailed | entityType=${entry.entityType} | entityId=${entry.entityId} | action=${entry.action} | error=${err.message}`,
      );
    }
  }
}
