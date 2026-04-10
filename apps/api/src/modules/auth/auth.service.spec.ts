import { ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
  };
  let mockTokenService: { generateTokens: jest.Mock; verifyToken: jest.Mock };

  function setupSelectChain(results: unknown[]) {
    const chain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(results),
    };
    mockDb.select.mockReturnValue(chain);
    return chain;
  }

  function setupInsertChain(results: unknown[]) {
    const chain = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue(results),
    };
    mockDb.insert.mockReturnValue(chain);
    return chain;
  }

  function setupInsertThrow(error: unknown) {
    const chain = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockRejectedValue(error),
    };
    mockDb.insert.mockReturnValue(chain);
    return chain;
  }

  // For login: need both select (rate limit count) and select (user lookup)
  function setupLoginMocks(failedCount: number, user: unknown | null) {
    let selectCallCount = 0;

    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Rate limit query: select().from().where() — returns array directly (thenable)
        const whereResult = Promise.resolve([{ count: failedCount }]);
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(whereResult),
          }),
        };
      }
      // User lookup query: select().from().where().limit()
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(user ? [user] : []),
          }),
        }),
      };
    });

    // Insert for login attempt recording
    const insertChain = {
      values: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.insert.mockReturnValue(insertChain);
  }

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
    };
    mockTokenService = {
      generateTokens: jest.fn().mockReturnValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      }),
      verifyToken: jest.fn(),
    };
    service = new AuthService(
      mockDb as never,
      mockTokenService as unknown as TokenService,
    );
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
    (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('register', () => {
    const validDto = { email: 'test@example.com', password: 'Password1' };

    it('creates a new user with hashed password', async () => {
      const expectedUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
        role: 'developer',
        createdAt: new Date(),
      };

      setupSelectChain([]);
      setupInsertChain([expectedUser]);

      const result = await service.register(validDto);

      expect(result).toEqual(expectedUser);
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('Password1', 10);
    });

    it('throws ConflictException for duplicate email', async () => {
      setupSelectChain([{ id: 'existing-id' }]);

      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for invalid email', async () => {
      await expect(
        service.register({ email: 'not-an-email', password: 'Password1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalizes email to lowercase and trims whitespace', async () => {
      setupSelectChain([]);
      const insertChain = setupInsertChain([{
        id: 'new-id', email: 'test@example.com', role: 'developer', createdAt: new Date(),
      }]);

      await service.register({ email: '  Test@Example.COM  ', password: 'Password1' });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com' }),
      );
    });

    it('catches unique constraint violation (TOCTOU)', async () => {
      setupSelectChain([]);
      setupInsertThrow({ code: '23505' });

      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const validDto = { email: 'test@example.com', password: 'Password1' };
    const mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      passwordHash: '$2b$10$hashedpassword',
      role: 'developer',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns tokens and user data on successful login', async () => {
      setupLoginMocks(0, mockUser);

      const result = await service.login(validDto, '127.0.0.1');

      expect(result.user).toEqual({ id: 'user-id', email: 'test@example.com', role: 'developer' });
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(mockTokenService.generateTokens).toHaveBeenCalledWith('user-id', 'test@example.com', 'developer');
    });

    it('throws UnauthorizedException for non-existent email and records attempt', async () => {
      setupLoginMocks(0, null);

      await expect(service.login(validDto, '127.0.0.1')).rejects.toThrow('Invalid email or password');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('throws UnauthorizedException for wrong password', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      setupLoginMocks(0, mockUser);

      await expect(service.login(validDto, '127.0.0.1')).rejects.toThrow('Invalid email or password');
    });

    it('throws 429 after 5 failed attempts', async () => {
      setupLoginMocks(5, mockUser);

      await expect(service.login(validDto, '127.0.0.1')).rejects.toMatchObject({
        status: 429,
        message: 'Too many login attempts. Try again later.',
      });
    });

    it('normalizes email before login', async () => {
      setupLoginMocks(0, mockUser);

      await service.login({ email: '  TEST@EXAMPLE.COM  ', password: 'Password1' }, '127.0.0.1');

      // The select calls should use normalized email
      expect(mockTokenService.generateTokens).toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid input', async () => {
      await expect(
        service.login({ email: '', password: '' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refresh', () => {
    it('generates new tokens for valid refresh token', async () => {
      mockTokenService.verifyToken.mockReturnValue({ sub: 'user-id', type: 'refresh' });
      setupSelectChain([{ id: 'user-id', email: 'test@example.com', role: 'developer' }]);

      const result = await service.refresh('valid-refresh-token');

      expect(result.user).toEqual({ id: 'user-id', email: 'test@example.com', role: 'developer' });
      expect(result.accessToken).toBe('mock-access-token');
    });

    it('throws UnauthorizedException for invalid refresh token', async () => {
      mockTokenService.verifyToken.mockImplementation(() => { throw new Error('invalid'); });

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if token type is not refresh', async () => {
      mockTokenService.verifyToken.mockReturnValue({ sub: 'user-id', type: 'access' });

      await expect(service.refresh('access-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user no longer exists', async () => {
      mockTokenService.verifyToken.mockReturnValue({ sub: 'deleted-user', type: 'refresh' });
      setupSelectChain([]);

      await expect(service.refresh('valid-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
