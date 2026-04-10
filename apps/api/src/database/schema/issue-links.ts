import { pgTable, uuid, timestamp, index, pgEnum, unique } from 'drizzle-orm/pg-core';
import { issues } from './issues';
import { users } from './users';

export const linkTypeEnum = pgEnum('link_type', ['related', 'blocks', 'created_from']);

export const issueLinks = pgTable(
  'issue_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceIssueId: uuid('source_issue_id').notNull().references(() => issues.id),
    targetIssueId: uuid('target_issue_id').notNull().references(() => issues.id),
    linkType: linkTypeEnum('link_type').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_issue_links_source').on(table.sourceIssueId),
    index('idx_issue_links_target').on(table.targetIssueId),
    unique('uq_issue_links_source_target_type').on(table.sourceIssueId, table.targetIssueId, table.linkType),
  ],
);

export type IssueLink = typeof issueLinks.$inferSelect;
export type NewIssueLink = typeof issueLinks.$inferInsert;
