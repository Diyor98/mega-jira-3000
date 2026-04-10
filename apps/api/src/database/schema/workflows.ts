import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
