import {
  Injectable,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { eq, and, gte, sql } from 'drizzle-orm';
import { MAX_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_MINUTES } from '@mega-jira/shared';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { users } from '../../database/schema/users';
import { loginAttempts } from '../../database/schema/login-attempts';
import { registerSchema, type RegisterDto } from './dto/register.dto';
import { loginSchema, type LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedDto = {
      ...dto,
      email: typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : dto.email,
    };

    const validation = registerSchema.safeParse(normalizedDto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { email, password } = validation.data;

    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let newUser;
    try {
      [newUser] = await this.db
        .insert(users)
        .values({ email, passwordHash })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
        });
    } catch (error: unknown) {
      const pgError = error as { code?: string };
      if (pgError.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    this.logger.log(`[AUDIT] user.created | actor=system | userId=${newUser.id} | email=${newUser.email}`);

    return newUser;
  }

  async login(dto: LoginDto, ipAddress: string) {
    const normalizedDto = {
      ...dto,
      email: typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : dto.email,
    };

    const validation = loginSchema.safeParse(normalizedDto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { email, password } = validation.data;

    // Check rate limit
    const lockoutWindow = new Date(Date.now() - LOGIN_LOCKOUT_MINUTES * 60 * 1000);
    const [failedCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, email),
          eq(loginAttempts.success, false),
          gte(loginAttempts.createdAt, lockoutWindow),
        ),
      );

    if (failedCount.count >= MAX_LOGIN_ATTEMPTS) {
      this.logger.warn(`[SECURITY] rate-limited | email=${email} | ip=${ipAddress}`);
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Find user
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      await this.recordLoginAttempt(email, ipAddress, false);
      this.logger.warn(`[SECURITY] failed-login | email=${email} | ip=${ipAddress}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await this.recordLoginAttempt(email, ipAddress, false);
      this.logger.warn(`[SECURITY] failed-login | email=${email} | ip=${ipAddress}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Success
    await this.recordLoginAttempt(email, ipAddress, true);
    const tokens = this.tokenService.generateTokens(user.id, user.email, user.role);

    this.logger.log(`[AUDIT] user.login | userId=${user.id} | email=${user.email}`);

    return {
      user: { id: user.id, email: user.email, role: user.role },
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; type?: string };
    try {
      payload = this.tokenService.verifyToken(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = this.tokenService.generateTokens(user.id, user.email, user.role);

    return { user, ...tokens };
  }

  private async recordLoginAttempt(email: string, ipAddress: string, success: boolean) {
    await this.db.insert(loginAttempts).values({ email, ipAddress, success });
  }
}
