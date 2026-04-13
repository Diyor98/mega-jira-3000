import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, isNull, desc, inArray, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { notifications } from '../../database/schema/notifications';
import { notificationPreferences } from '../../database/schema/notification-preferences';
import { users } from '../../database/schema/users';
import { issues } from '../../database/schema/issues';
import { projects } from '../../database/schema/projects';

export type NotificationType = 'mentioned' | 'assigned' | 'status_changed';

export interface NotificationInsertRow {
  userId: string;
  type: NotificationType;
  issueId: string;
  commentId?: string | null;
  actorId: string;
}

/**
 * Any Drizzle-like handle — the real `this.db` OR a transaction handle
 * (`tx`) passed in from another service's in-flight transaction.
 */
type DrizzleHandle = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Fire-and-forget bulk insert. Called by other services (CommentsService,
   * IssuesService) inside their in-flight transactions so the notification
   * insert is atomic with the primary action. Failures are caught, logged at
   * warn level, and swallowed — a broken notification path must NOT roll
   * back a legitimate comment/issue mutation.
   */
  async createBulk(
    handle: DrizzleHandle,
    rows: NotificationInsertRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    try {
      // Story 6.4: filter rows against each recipient's preferences. Batch-
      // load all preferences via a single `SELECT ... WHERE user_id IN (...)`
      // — a user with no row is implicitly all-enabled (matches the default).
      const recipientIds = Array.from(new Set(rows.map((r) => r.userId)));
      const prefRows = await handle
        .select({
          userId: notificationPreferences.userId,
          mentioned: notificationPreferences.mentioned,
          assigned: notificationPreferences.assigned,
          statusChanged: notificationPreferences.statusChanged,
        })
        .from(notificationPreferences)
        .where(inArray(notificationPreferences.userId, recipientIds));

      const prefsByUser = new Map<
        string,
        { mentioned: boolean; assigned: boolean; status_changed: boolean }
      >();
      for (const p of prefRows) {
        prefsByUser.set(p.userId, {
          mentioned: p.mentioned,
          assigned: p.assigned,
          status_changed: p.statusChanged,
        });
      }

      const filtered = rows.filter((r) => {
        const prefs = prefsByUser.get(r.userId);
        if (!prefs) return true; // no row = defaults = all enabled
        return prefs[r.type] !== false;
      });

      if (filtered.length === 0) return;

      await handle.insert(notifications).values(
        filtered.map((r) => ({
          userId: r.userId,
          type: r.type,
          issueId: r.issueId,
          commentId: r.commentId ?? null,
          actorId: r.actorId,
        })),
      );
      for (const r of filtered) {
        this.logger.debug(
          `[DEBUG] notification.created | userId=${r.userId} | type=${r.type} | actorId=${r.actorId} | issueId=${r.issueId}`,
        );
      }
    } catch (e) {
      // Swallow — notifications are best-effort. Do not roll back the caller's tx.
      this.logger.warn(
        `[AUDIT] notification.insertFailed | count=${rows.length} | error=${(e as Error).message}`,
      );
    }
  }

  /** List the caller's 50 most-recent notifications, newest first. */
  async listForUser(userId: string) {
    return this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        issueId: notifications.issueId,
        issueKey: issues.issueKey,
        issueTitle: issues.title,
        projectKey: projects.key,
        commentId: notifications.commentId,
        actorId: notifications.actorId,
        actorEmail: users.email,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .innerJoin(issues, eq(notifications.issueId, issues.id))
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .innerJoin(users, eq(notifications.actorId, users.id))
      // Filter soft-deleted issues so notifications pointing at deleted issues
      // don't leak the issue title/key into the dropdown.
      .where(
        and(eq(notifications.userId, userId), isNull(issues.deletedAt)),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return { count: row?.count ?? 0 };
  }

  async markRead(userId: string, notificationId: string) {
    // Scope by (id, user_id) — a non-owner hits 404, not 403 (no existence leak).
    const [target] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .limit(1);

    if (!target) {
      throw new NotFoundException('Notification not found');
    }

    const readAt = new Date();
    await this.db
      .update(notifications)
      .set({ readAt })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      );

    return { id: notificationId, readAt: readAt.toISOString() };
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });

    this.logger.log(
      `[AUDIT] notification.markAllRead | userId=${userId} | count=${updated.length}`,
    );

    return { count: updated.length };
  }
}
