import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AttachmentsService, type UploadedFileLike } from './attachments.service';

/**
 * Parse `ATTACHMENT_MAX_BYTES` at module load. Reject NaN / non-positive
 * values at startup so a misconfigured env var can't silently disable
 * Multer's fileSize limit.
 */
function resolveMaxBytes(): number {
  const raw = process.env.ATTACHMENT_MAX_BYTES ?? '52428800';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `ATTACHMENT_MAX_BYTES must be a positive finite number (got "${raw}")`,
    );
  }
  return parsed;
}

const MAX_BYTES = resolveMaxBytes();

@Controller('api/v1/projects/:projectKey/issues/:issueId/attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }),
  )
  async upload(
    @Param('projectKey') projectKey: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected field "file")');
    }
    return this.service.create(projectKey, issueId, this.getUserId(req), file);
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

  @Get(':attachmentId/download')
  @HttpCode(HttpStatus.OK)
  async download(
    @Param('projectKey') projectKey: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() req: Request,
  ) {
    return this.service.getFileStream(
      projectKey,
      issueId,
      attachmentId,
      this.getUserId(req),
    );
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('projectKey') projectKey: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() req: Request,
  ) {
    return this.service.delete(
      projectKey,
      issueId,
      attachmentId,
      this.getUserId(req),
    );
  }
}
