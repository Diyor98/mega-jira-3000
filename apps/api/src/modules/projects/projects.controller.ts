import { Controller, Post, Get, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService } from './projects.service';
import type { CreateProjectDto } from './dto/create-project.dto';

@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateProjectDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.projectsService.create(body, userId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Req() req: Request) {
    const userId = (req as any).user.userId;
    return this.projectsService.findByOwner(userId);
  }
}
