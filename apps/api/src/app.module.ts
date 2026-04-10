import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IssuesModule } from './modules/issues/issues.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
            '*.email',
            '*.token',
            '*.accessToken',
            '*.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req: { url?: string }) => req.url === '/api/v1/health',
        },
      },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    IssuesModule,
  ],
})
export class AppModule {}
