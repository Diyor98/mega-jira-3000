import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  projectMemberCreateSchema,
  projectMemberUpdateSchema,
} from '@mega-jira/shared';
import { ProjectMembersService } from './project-members.service';

@Controller('api/v1/projects/:projectKey/members')
export class ProjectMembersController {
  constructor(private readonly service: ProjectMembersService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Param('projectKey') projectKey: string, @Req() req: Request) {
    return this.service.listByProject(projectKey, this.getUserId(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Param('projectKey') projectKey: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = projectMemberCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    return this.service.addMember(projectKey, this.getUserId(req), parsed.data);
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('projectKey') projectKey: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = projectMemberUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    return this.service.updateRole(projectKey, this.getUserId(req), userId, parsed.data.role);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('projectKey') projectKey: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    return this.service.removeMember(projectKey, this.getUserId(req), userId);
  }
}
