import { JwtService } from '@nestjs/jwt';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '@mega-jira/shared';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let tokenService: TokenService;
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  beforeEach(() => {
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-token'),
      verify: jest.fn(),
    };
    tokenService = new TokenService(jwtService as unknown as JwtService);
  });

  describe('generateTokens', () => {
    it('generates access and refresh tokens', () => {
      const result = tokenService.generateTokens('user-id', 'test@example.com', 'developer');

      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('signs access token with correct payload and expiry', () => {
      tokenService.generateTokens('user-id', 'test@example.com', 'developer');

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id', email: 'test@example.com', role: 'developer' },
        { expiresIn: JWT_ACCESS_EXPIRY },
      );
    });

    it('signs refresh token with type field and 7d expiry', () => {
      tokenService.generateTokens('user-id', 'test@example.com', 'developer');

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id', type: 'refresh' },
        { expiresIn: JWT_REFRESH_EXPIRY },
      );
    });
  });

  describe('verifyToken', () => {
    it('delegates to jwtService.verify', () => {
      jwtService.verify.mockReturnValue({ sub: 'user-id' });

      const result = tokenService.verifyToken('some-token');

      expect(jwtService.verify).toHaveBeenCalledWith('some-token', { algorithms: ['HS256'] });
      expect(result).toEqual({ sub: 'user-id' });
    });

    it('throws when token is invalid', () => {
      jwtService.verify.mockImplementation(() => { throw new Error('invalid token'); });

      expect(() => tokenService.verifyToken('bad-token')).toThrow('invalid token');
    });
  });
});
