import { Controller, Post, Body, HttpCode, HttpStatus, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax' as const,
  path: '/',
};

const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(body, req.ip ?? '0.0.0.0');

    res.cookie('access_token', result.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });
    res.cookie('refresh_token', result.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });

    return result.user;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }

    const result = await this.authService.refresh(refreshToken);

    res.cookie('access_token', result.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });
    res.cookie('refresh_token', result.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });

    return result.user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);
    return { message: 'Logged out' };
  }
}
