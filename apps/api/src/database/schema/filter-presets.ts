import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import type { FilterPresetConfig } from '@mega-jira/shared';

export const filterPresets = pgTable(
  'filter_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    filterConfig: jsonb('filter_config').$type<FilterPresetConfig>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_filter_presets_user_project').on(table.userId, table.projectId),
    uniqueIndex('uq_filter_presets_user_project_name').on(
      table.userId,
      table.projectId,
      table.name,
    ),
  ],
);

export type FilterPreset = typeof filterPresets.$inferSelect;
export type NewFilterPreset = typeof filterPresets.$inferInsert;
