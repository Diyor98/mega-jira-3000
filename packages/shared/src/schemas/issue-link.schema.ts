import { z } from 'zod';

export const createIssueLinkSchema = z.object({
  targetIssueId: z.string().uuid('Invalid target issue ID'),
  linkType: z.enum(['related', 'blocks', 'created_from'], { required_error: 'Link type is required' }),
});

export type CreateIssueLinkInput = z.infer<typeof createIssueLinkSchema>;
