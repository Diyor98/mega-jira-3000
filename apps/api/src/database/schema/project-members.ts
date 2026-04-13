import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('project_members_project_user_unique').on(table.projectId, table.userId),
  ],
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;
