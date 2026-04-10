import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const issueSequences = pgTable('issue_sequences', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id),
  nextSequence: integer('next_sequence').notNull().default(1),
});

export type IssueSequence = typeof issueSequences.$inferSelect;
