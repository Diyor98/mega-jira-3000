import { z } from 'zod';

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Project name is required')
      .max(100, 'Project name must be 100 characters or fewer')
      .optional(),
    description: z
      .string()
      .max(500, 'Description must be 500 characters or fewer')
      .nullable()
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: 'At least one field (name or description) must be provided',
  });

export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
