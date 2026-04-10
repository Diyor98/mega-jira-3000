import { z } from 'zod';

export const createIssueSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer'),
  type: z.enum(['Epic', 'Story', 'Task', 'Bug'], { required_error: 'Type is required' }),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional().default('P3'),
  assigneeId: z.string().uuid('Invalid assignee ID').optional(),
  description: z.string().optional(),
  parentId: z.string().uuid('Invalid parent ID').optional(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer').optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().uuid('Invalid assignee ID').nullable().optional(),
  parentId: z.string().uuid('Invalid parent ID').nullable().optional(),
  issueVersion: z.number().int().positive('Issue version is required'),
});

export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
