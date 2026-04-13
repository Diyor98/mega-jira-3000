import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_log_project_created').on(table.projectId, table.createdAt),
    index('idx_audit_log_entity_created').on(table.entityType, table.entityId, table.createdAt),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
