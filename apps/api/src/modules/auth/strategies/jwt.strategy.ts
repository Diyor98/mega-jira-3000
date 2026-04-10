import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import type { Request } from 'express';

function extractFromCookie(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractFromCookie]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  validate(payload: { sub: string; email: string; role: string; type?: string }) {
    if (payload.type === 'refresh') {
      return null;
    }
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
