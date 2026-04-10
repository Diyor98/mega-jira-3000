import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock; refresh: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn(), refresh: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /api/v1/auth/register', () => {
    it('calls authService.register and returns result', async () => {
      const dto = { email: 'test@example.com', password: 'Password1' };
      const expectedUser = { id: 'user-id', email: 'test@example.com', role: 'developer', createdAt: new Date() };
      authService.register.mockResolvedValue(expectedUser);

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('calls authService.login and sets cookies', async () => {
      const dto = { email: 'test@example.com', password: 'Password1' };
      const loginResult = {
        user: { id: 'user-id', email: 'test@example.com', role: 'developer' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      authService.login.mockResolvedValue(loginResult);

      const mockReq = { ip: '127.0.0.1' } as never;
      const mockRes = { cookie: jest.fn() } as never;

      const result = await controller.login(dto, mockReq, mockRes);

      expect(authService.login).toHaveBeenCalledWith(dto, '127.0.0.1');
      expect(result).toEqual(loginResult.user);
      const cookieMock = (mockRes as { cookie: jest.Mock }).cookie;
      expect(cookieMock).toHaveBeenCalledTimes(2);
      expect(cookieMock).toHaveBeenCalledWith(
        'access_token',
        'access-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(cookieMock).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('refreshes tokens from cookie', async () => {
      const refreshResult = {
        user: { id: 'user-id', email: 'test@example.com', role: 'developer' },
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      };
      authService.refresh.mockResolvedValue(refreshResult);

      const mockReq = { cookies: { refresh_token: 'old-refresh' } } as never;
      const mockRes = { cookie: jest.fn() } as never;

      const result = await controller.refresh(mockReq, mockRes);

      expect(authService.refresh).toHaveBeenCalledWith('old-refresh');
      expect(result).toEqual(refreshResult.user);
    });

    it('throws UnauthorizedException when no refresh cookie', async () => {
      const mockReq = { cookies: {} } as never;
      const mockRes = { cookie: jest.fn() } as never;

      await expect(controller.refresh(mockReq, mockRes)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('clears both cookies', async () => {
      const mockRes = { clearCookie: jest.fn() } as never;

      const result = await controller.logout(mockRes);

      expect(result).toEqual({ message: 'Logged out' });
      const clearMock = (mockRes as { clearCookie: jest.Mock }).clearCookie;
      expect(clearMock).toHaveBeenCalledTimes(2);
      expect(clearMock).toHaveBeenCalledWith('access_token', expect.objectContaining({ httpOnly: true }));
      expect(clearMock).toHaveBeenCalledWith('refresh_token', expect.objectContaining({ httpOnly: true }));
    });
  });
});
