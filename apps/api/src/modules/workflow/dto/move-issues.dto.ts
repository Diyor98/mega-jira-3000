import { z } from 'zod';

export const moveIssuesSchema = z.object({
  targetStatusId: z
    .string({ required_error: 'targetStatusId is required' })
    .uuid('targetStatusId must be a UUID'),
});

export type MoveIssuesDto = z.infer<typeof moveIssuesSchema>;
