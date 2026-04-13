import {
  Controller,
  Get,
  Patch,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: Request) {
    return this.service.listForUser(this.getUserId(req));
  }

  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async unreadCount(@Req() req: Request) {
    return this.service.unreadCount(this.getUserId(req));
  }

  @Patch('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Req() req: Request) {
    return this.service.markAllRead(this.getUserId(req));
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.service.markRead(this.getUserId(req), id);
  }
}
