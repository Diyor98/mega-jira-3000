import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  API_PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Story 7.1 attachments
  ATTACHMENT_STORAGE_DIR: z.string().default('./var/attachments'),
  ATTACHMENT_MAX_BYTES: z.coerce.number().default(52_428_800),
  // Story 7.2 data lifecycle
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Comma-separated list of user UUIDs allowed to call
  // POST /admin/lifecycle/purge-now. Empty/missing disables the endpoint.
  ADMIN_USER_IDS: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  return result.data;
}
