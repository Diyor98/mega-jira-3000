import { z } from 'zod';

export const updateNotificationPreferencesSchema = z
  .object({
    mentioned: z.boolean().optional(),
    assigned: z.boolean().optional(),
    status_changed: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one preference field is required',
  });

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export interface NotificationPreferencesDto {
  mentioned: boolean;
  assigned: boolean;
  status_changed: boolean;
}
