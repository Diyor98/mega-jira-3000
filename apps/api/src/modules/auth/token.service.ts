import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '@mega-jira/shared';

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  generateTokens(userId: string, email: string, role: string) {
    const accessToken = this.jwtService.sign(
      { sub: userId, email, role },
      { expiresIn: JWT_ACCESS_EXPIRY },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      { expiresIn: JWT_REFRESH_EXPIRY },
    );

    return { accessToken, refreshToken };
  }

  verifyToken(token: string) {
    return this.jwtService.verify(token, { algorithms: ['HS256'] });
  }
}
