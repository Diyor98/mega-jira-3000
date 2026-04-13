import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import {
  notificationPreferences,
  type NewNotificationPreferences,
} from '../../database/schema/notification-preferences';
import {
  updateNotificationPreferencesSchema,
  type UpdateNotificationPreferencesInput,
  type NotificationPreferencesDto,
} from '@mega-jira/shared';

const DEFAULTS: NotificationPreferencesDto = {
  mentioned: true,
  assigned: true,
  status_changed: true,
};

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Returns the caller's preferences, hydrating defaults (all-true) when no
   * row exists. A brand-new user has no row and receives all notification
   * types until they explicitly toggle one off.
   */
  async get(userId: string): Promise<NotificationPreferencesDto> {
    const [row] = await this.db
      .select({
        mentioned: notificationPreferences.mentioned,
        assigned: notificationPreferences.assigned,
        statusChanged: notificationPreferences.statusChanged,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (!row) return { ...DEFAULTS };

    return {
      mentioned: row.mentioned,
      assigned: row.assigned,
      status_changed: row.statusChanged,
    };
  }

  async update(
    userId: string,
    dto: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesDto> {
    const parsed = updateNotificationPreferencesSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const patch = parsed.data;

    // Build the update set (only provided fields) + the full insert values
    // (provided or defaults) for the upsert.
    const now = new Date();
    const insertValues = {
      userId,
      mentioned: patch.mentioned ?? DEFAULTS.mentioned,
      assigned: patch.assigned ?? DEFAULTS.assigned,
      statusChanged: patch.status_changed ?? DEFAULTS.status_changed,
      updatedAt: now,
    };
    // Narrow type so TypeScript catches any column-name typos at compile
    // time (`statusChanges` vs `statusChanged`, etc.). Drizzle's `set`
    // parameter accepts a partial of the insert shape.
    const updateSet: Partial<
      Pick<
        NewNotificationPreferences,
        'mentioned' | 'assigned' | 'statusChanged' | 'updatedAt'
      >
    > = { updatedAt: now };
    if (patch.mentioned !== undefined) updateSet.mentioned = patch.mentioned;
    if (patch.assigned !== undefined) updateSet.assigned = patch.assigned;
    if (patch.status_changed !== undefined) updateSet.statusChanged = patch.status_changed;

    const [row] = await this.db
      .insert(notificationPreferences)
      .values(insertValues)
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: updateSet,
      })
      .returning({
        mentioned: notificationPreferences.mentioned,
        assigned: notificationPreferences.assigned,
        statusChanged: notificationPreferences.statusChanged,
      });

    const changedFields = Object.keys(patch);
    this.logger.log(
      `[AUDIT] notificationPreferences.updated | userId=${userId} | changedFields=[${changedFields.join(',')}]`,
    );

    return {
      mentioned: row.mentioned,
      assigned: row.assigned,
      status_changed: row.statusChanged,
    };
  }
}
