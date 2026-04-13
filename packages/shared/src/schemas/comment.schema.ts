import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Body is required')
    .max(10000, 'Body must be 10000 characters or fewer'),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
