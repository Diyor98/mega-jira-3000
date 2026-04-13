import { z } from 'zod';

const requireAssigneeSchema = z.object({
  ruleType: z.literal('require_assignee'),
  fromStatusId: z.string().uuid().nullable(),
  toStatusId: z.string().uuid(),
});

const requireFieldSchema = z.object({
  ruleType: z.literal('require_field'),
  fromStatusId: z.string().uuid().nullable(),
  toStatusId: z.string().uuid(),
  // MVP only supports 'resolution'; future story 4.4+ can add more.
  requiredField: z.enum(['resolution']),
});

export const addRuleSchema = z.discriminatedUnion('ruleType', [
  requireAssigneeSchema,
  requireFieldSchema,
]);

export type AddRuleDto = z.infer<typeof addRuleSchema>;
