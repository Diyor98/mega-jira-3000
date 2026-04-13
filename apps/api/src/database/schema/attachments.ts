import { pgTable, uuid, varchar, bigint, timestamp, index } from 'drizzle-orm/pg-core';
import { issues } from './issues';
import { users } from './users';

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    storedName: varchar('stored_name', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_attachments_issue_created').on(table.issueId, table.createdAt),
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
