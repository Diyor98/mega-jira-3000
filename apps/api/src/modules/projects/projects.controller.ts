import { Controller, Post, Patch, Get, Param, Body, HttpCode, HttpStatus, Req, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService } from './projects.service';
import { RbacService } from '../rbac/rbac.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

@Controller('api/v1/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateProjectDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.projectsService.create(body, userId);
  }

  @Patch(':projectKey')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('projectKey') projectKey: string,
    @Body() body: UpdateProjectDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    if (this.rbac) {
      await this.rbac.assertAction(projectKey, userId, 'project.edit');
    }
    return this.projectsService.updateMetadata(projectKey, body, userId);
  }

  @Get(':projectKey/statuses')
  @HttpCode(HttpStatus.OK)
  async getStatuses(@Param('projectKey') projectKey: string, @Req() req: Request) {
    if (this.rbac) {
      const userId = (req as any).user.userId;
      await this.rbac.assertAction(projectKey, userId, 'project.read');
    }
    return this.projectsService.getStatuses(projectKey);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Req() req: Request) {
    const userId = (req as any).user.userId;
    return this.projectsService.findByOwner(userId);
  }
}
