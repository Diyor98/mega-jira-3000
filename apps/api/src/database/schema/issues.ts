import { pgTable, uuid, varchar, text, integer, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { workflowStatuses } from './workflow-statuses';
import { users } from './users';

export const issueTypeEnum = pgEnum('issue_type', ['epic', 'story', 'task', 'bug']);
export const issuePriorityEnum = pgEnum('issue_priority', ['P1', 'P2', 'P3', 'P4']);

export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    issueKey: varchar('issue_key', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    type: issueTypeEnum('type').notNull(),
    priority: issuePriorityEnum('priority').notNull().default('P3'),
    statusId: uuid('status_id').notNull().references(() => workflowStatuses.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    reporterId: uuid('reporter_id').notNull().references(() => users.id),
    parentId: uuid('parent_id'),
    issueVersion: integer('issue_version').notNull().default(1),
    resolution: text('resolution'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_issues_project_id').on(table.projectId),
    index('idx_issues_project_status').on(table.projectId, table.statusId),
    index('idx_issues_assignee').on(table.assigneeId),
  ],
);

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
