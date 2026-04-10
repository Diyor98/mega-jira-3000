import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { workflows } from './workflows';

export const workflowStatuses = pgTable(
  'workflow_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
    name: varchar('name', { length: 100 }).notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_statuses_workflow_position').on(table.workflowId, table.position),
  ],
);

export type WorkflowStatus = typeof workflowStatuses.$inferSelect;
export type NewWorkflowStatus = typeof workflowStatuses.$inferInsert;
