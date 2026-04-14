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
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  projectMemberCreateSchema,
  projectMemberUpdateSchema,
} from '@mega-jira/shared';
import { ProjectMembersService } from './project-members.service';
import { RbacService } from '../rbac/rbac.service';
import { RBAC_MATRIX, type PermissionAction } from '../rbac/rbac.matrix';

@Controller('api/v1/projects/:projectKey/members')
export class ProjectMembersController {
  constructor(
    private readonly service: ProjectMembersService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Param('projectKey') projectKey: string, @Req() req: Request) {
    return this.service.listByProject(projectKey, this.getUserId(req));
  }

  /**
   * Story 8.2: returns the caller's role + computed permission set for the
   * project. The frontend uses this to gate UI controls. Computed flat from
   * `RBAC_MATRIX` so the server stays the source of truth and the client
   * never has to derive permissions from a hardcoded role.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(@Param('projectKey') projectKey: string, @Req() req: Request) {
    const userId = this.getUserId(req);
    if (!this.rbac) {
      return { projectKey, role: null, permissions: {} };
    }
    const ctx = await this.rbac.loadContext(projectKey, userId);
    const permissions: Record<string, boolean> = {};
    for (const action of Object.keys(RBAC_MATRIX) as PermissionAction[]) {
      const allowed = RBAC_MATRIX[action] as readonly string[];
      permissions[action] = allowed.includes(ctx.role);
    }
    return { projectKey, role: ctx.role, permissions };
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
