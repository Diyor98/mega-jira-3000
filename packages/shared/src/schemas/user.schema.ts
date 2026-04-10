import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least 1 uppercase letter')
    .regex(/\d/, 'Password must contain at least 1 number'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
