import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { lt, and, isNotNull, eq, inArray } from 'drizzle-orm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { issues } from '../../database/schema/issues';
import { comments } from '../../database/schema/comments';
import { attachments } from '../../database/schema/attachments';
import { resolveAttachmentPath } from '../attachments/attachment-path';

/**
 * Shared retention-days resolver used by both the lifecycle cron and
 * `IssuesService.restore()`. Having two parsers was a source-of-truth
 * drift risk: if one throws on invalid input and the other coerces to
 * NaN, behavior diverges (restore's window check would silently always
 * fail on a bad env var).
 */
export function resolveRetentionDays(): number {
  const raw = process.env.DATA_RETENTION_DAYS ?? '30';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `DATA_RETENTION_DAYS must be a positive finite number (got "${raw}")`,
    );
  }
  return parsed;
}

function resolveBaseDir(): string {
  const raw = process.env.ATTACHMENT_STORAGE_DIR ?? './var/attachments';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export interface PurgeReport {
  issues: number;
  comments: number;
  attachments: number;
  attachmentBytes: number;
  errors: string[];
}

@Injectable()
export class DataLifecycleService {
  private readonly logger = new Logger(DataLifecycleService.name);
  private readonly retentionDays = resolveRetentionDays();
  private readonly baseDir = resolveBaseDir();
  // In-process re-entrance guard: prevents overlapping cron+manual
  // invocations from racing on the same rows. Distributed lock (Redis
  // SET NX EX) is deferred to the multi-instance story.
  private running = false;

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Runs daily at 03:00 server time. Hard-deletes any row whose `deletedAt`
   * is older than DATA_RETENTION_DAYS. Orphaned attachment files are
   * fs.unlink'd. Per-entity try/catch so one failing entity doesn't block
   * the others.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    await this.purgeExpired();
  }

  async purgeExpired(): Promise<PurgeReport> {
    if (this.running) {
      this.logger.warn('[AUDIT] lifecycle.purge.skipped | reason=already_running');
      return { issues: 0, comments: 0, attachments: 0, attachmentBytes: 0, errors: ['already running'] };
    }
    this.running = true;
    try {
      return await this.runPurge();
    } finally {
      this.running = false;
    }
  }

  private async runPurge(): Promise<PurgeReport> {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    const report: PurgeReport = {
      issues: 0,
      comments: 0,
      attachments: 0,
      attachmentBytes: 0,
      errors: [],
    };

    // ---- attachments first: unlink files before the issue cascade eats
    // their rows. This loop handles attachments whose parent issue was
    // NOT itself past the window (orphaned soft-deletes).
    try {
      const expired = await this.db
        .select({
          id: attachments.id,
          issueId: attachments.issueId,
          storedName: attachments.storedName,
          sizeBytes: attachments.sizeBytes,
        })
        .from(attachments)
        .where(
          and(isNotNull(attachments.deletedAt), lt(attachments.deletedAt, cutoff)),
        );

      // Batch issue→project lookup once for the whole set, instead of N+1
      // per-attachment SELECTs (previous review finding M2 / H2).
      const issueIdSet = Array.from(new Set(expired.map((a) => a.issueId)));
      const projectMap = new Map<string, string>();
      if (issueIdSet.length > 0) {
        const issueRows = await this.db
          .select({ id: issues.id, projectId: issues.projectId })
          .from(issues)
          .where(inArray(issues.id, issueIdSet));
        for (const row of issueRows) {
          projectMap.set(row.id, row.projectId);
        }
      }

      for (const att of expired) {
        const projectId = projectMap.get(att.issueId);
        if (projectId) {
          try {
            const abs = resolveAttachmentPath(
              this.baseDir,
              projectId,
              att.issueId,
              att.storedName,
            );
            try {
              await fs.unlink(abs);
              report.attachmentBytes += att.sizeBytes;
            } catch (e) {
              const err = e as NodeJS.ErrnoException;
              if (err.code !== 'ENOENT') {
                report.errors.push(`unlink ${abs}: ${err.message}`);
              }
            }
          } catch (e) {
            // resolveAttachmentPath threw on traversal guard — log & skip
            report.errors.push(`resolve ${att.id}: ${(e as Error).message}`);
          }
        }
        await this.db.delete(attachments).where(eq(attachments.id, att.id));
        report.attachments++;
      }
    } catch (e) {
      report.errors.push(`attachments: ${(e as Error).message}`);
      this.logger.error(`purge.attachments failed: ${(e as Error).message}`);
    }

    // ---- comments (those whose parent issue is NOT also purged)
    try {
      const deleted = await this.db
        .delete(comments)
        .where(and(isNotNull(comments.deletedAt), lt(comments.deletedAt, cutoff)))
        .returning({ id: comments.id });
      report.comments = deleted.length;
    } catch (e) {
      report.errors.push(`comments: ${(e as Error).message}`);
      this.logger.error(`purge.comments failed: ${(e as Error).message}`);
    }

    // ---- issues (cascades to remaining comments/attachments via FK)
    try {
      const deleted = await this.db
        .delete(issues)
        .where(and(isNotNull(issues.deletedAt), lt(issues.deletedAt, cutoff)))
        .returning({ id: issues.id });
      report.issues = deleted.length;
    } catch (e) {
      report.errors.push(`issues: ${(e as Error).message}`);
      this.logger.error(`purge.issues failed: ${(e as Error).message}`);
    }

    this.logger.log(
      `[AUDIT] lifecycle.purged | windowDays=${this.retentionDays} | issues=${report.issues} | comments=${report.comments} | attachments=${report.attachments} | bytes=${report.attachmentBytes} | errors=${report.errors.length}`,
    );

    return report;
  }
}
