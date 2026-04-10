import { registerSchema } from './register.dto';

describe('registerSchema', () => {
  it('accepts valid email and password', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Password1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'Password1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Pass1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without uppercase letter', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'password1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without number', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Password',
    });
    expect(result.success).toBe(false);
  });

  it('accepts password with exactly 8 characters meeting all criteria', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Abcdefg1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects password exceeding 128 characters', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'A1' + 'a'.repeat(127),
    });
    expect(result.success).toBe(false);
  });
});
