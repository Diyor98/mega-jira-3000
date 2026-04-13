import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workflows } from './workflows';
import { workflowStatuses } from './workflow-statuses';

export const workflowRules = pgTable(
  'workflow_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    fromStatusId: uuid('from_status_id').references(() => workflowStatuses.id, {
      onDelete: 'cascade',
    }),
    toStatusId: uuid('to_status_id')
      .notNull()
      .references(() => workflowStatuses.id, { onDelete: 'cascade' }),
    ruleType: varchar('rule_type', { length: 50 }).notNull(),
    requiredField: varchar('required_field', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_workflow_rules_workflow_to').on(table.workflowId, table.toStatusId),
    // NULLS NOT DISTINCT is applied in the SQL migration (0005, 0006) —
    // drizzle-orm 0.45 `uniqueIndex()` builder does not expose a
    // `.nullsNotDistinct()` method (it is only available on `unique()`
    // constraint builders). Do NOT regenerate via `drizzle-kit generate`
    // — the SQL migration is the source of truth for this property.
    uniqueIndex('uq_workflow_rules_workflow_from_to_type_field').on(
      table.workflowId,
      table.fromStatusId,
      table.toStatusId,
      table.ruleType,
      table.requiredField,
    ),
  ],
);

export type WorkflowRule = typeof workflowRules.$inferSelect;
export type NewWorkflowRule = typeof workflowRules.$inferInsert;
