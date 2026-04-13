import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { NotificationPreferencesService } from './notification-preferences.service';
import type { UpdateNotificationPreferencesInput } from '@mega-jira/shared';

@Controller('api/v1/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async get(@Req() req: Request) {
    return this.service.get(this.getUserId(req));
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async update(
    @Body() body: UpdateNotificationPreferencesInput,
    @Req() req: Request,
  ) {
    return this.service.update(this.getUserId(req), body);
  }
}
