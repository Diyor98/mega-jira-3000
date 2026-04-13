import { z } from 'zod';

export const addStatusSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'Status name cannot be empty')
    .max(100, 'Status name must be at most 100 characters'),
});

export type AddStatusDto = z.infer<typeof addStatusSchema>;
