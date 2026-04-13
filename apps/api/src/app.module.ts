import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IssuesModule } from './modules/issues/issues.module';
import { BoardModule } from './modules/board/board.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { UsersModule } from './modules/users/users.module';
import { FilterPresetsModule } from './modules/filter-presets/filter-presets.module';
import { CommentsModule } from './modules/comments/comments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

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
    BoardModule,
    WorkflowModule,
    UsersModule,
    FilterPresetsModule,
    CommentsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
