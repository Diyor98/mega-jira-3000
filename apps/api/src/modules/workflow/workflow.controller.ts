import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { WorkflowService } from './workflow.service';
import type { AddStatusDto } from './dto/add-status.dto';
import type { UpdateStatusDto } from './dto/update-status.dto';
import type { MoveIssuesDto } from './dto/move-issues.dto';

@Controller('api/v1/projects/:projectKey/workflow/statuses')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addStatus(
    @Param('projectKey') projectKey: string,
    @Body() body: AddStatusDto,
    @Req() req: Request,
  ) {
    return this.workflowService.addStatus(projectKey, this.getUserId(req), body);
  }

  @Patch(':statusId')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('projectKey') projectKey: string,
    @Param('statusId', new ParseUUIDPipe()) statusId: string,
    @Body() body: UpdateStatusDto,
    @Req() req: Request,
  ) {
    return this.workflowService.updateStatus(projectKey, this.getUserId(req), statusId, body);
  }

  @Delete(':statusId')
  @HttpCode(HttpStatus.OK)
  async deleteStatus(
    @Param('projectKey') projectKey: string,
    @Param('statusId', new ParseUUIDPipe()) statusId: string,
    @Req() req: Request,
  ) {
    return this.workflowService.deleteStatus(projectKey, this.getUserId(req), statusId);
  }

  @Post(':statusId/move-issues')
  @HttpCode(HttpStatus.OK)
  async moveIssues(
    @Param('projectKey') projectKey: string,
    @Param('statusId', new ParseUUIDPipe()) statusId: string,
    @Body() body: MoveIssuesDto,
    @Req() req: Request,
  ) {
    return this.workflowService.bulkMoveIssues(
      projectKey,
      this.getUserId(req),
      statusId,
      body,
    );
  }
}
