import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(255, 'Project name must be 255 characters or fewer'),
  key: z
    .string()
    .min(2, 'Project key must be at least 2 characters')
    .max(10, 'Project key must be 10 characters or fewer')
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Project key must be uppercase alphanumeric starting with a letter'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
