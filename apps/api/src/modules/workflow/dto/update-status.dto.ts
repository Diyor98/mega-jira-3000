import { z } from 'zod';

export const updateStatusSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Status name cannot be empty')
      .max(100, 'Status name must be at most 100 characters')
      .optional(),
    position: z.coerce
      .number()
      .int('position must be an integer')
      .min(1, 'position must be >= 1')
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.position !== undefined, {
    message: 'At least one of name or position must be provided',
  });

export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;
