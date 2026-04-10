import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    success: boolean('success').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_login_attempts_email_created_at').on(table.email, table.createdAt),
  ],
);
