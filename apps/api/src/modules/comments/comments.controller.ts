import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { CommentsService } from './comments.service';
import type { CreateCommentInput } from '@mega-jira/shared';

@Controller('api/v1/projects/:projectKey/issues/:issueId/comments')
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectKey') projectKey: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Body() body: CreateCommentInput,
    @Req() req: Request,
  ) {
    return this.service.create(projectKey, issueId, this.getUserId(req), body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('projectKey') projectKey: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Req() req: Request,
  ) {
    return this.service.listByIssue(projectKey, issueId, this.getUserId(req));
  }
}
