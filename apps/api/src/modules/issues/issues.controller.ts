import { Controller, Post, Get, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IssuesService } from './issues.service';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { UpdateIssueDto } from './dto/update-issue.dto';
import type { CreateIssueLinkDto } from './dto/create-issue-link.dto';

@Controller('api/v1/projects/:projectKey/issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateIssueDto,
    @Param('projectKey') projectKey: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.issuesService.create(body, userId, projectKey);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Param('projectKey') projectKey: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.issuesService.findByProject(projectKey, query);
  }

  @Get(':issueId/children')
  @HttpCode(HttpStatus.OK)
  async findChildren(
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
  ) {
    return this.issuesService.findChildren(projectKey, issueId);
  }

  @Post(':issueId/links')
  @HttpCode(HttpStatus.CREATED)
  async createLink(
    @Body() body: CreateIssueLinkDto,
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.issuesService.createLink(projectKey, issueId, body, userId);
  }

  @Get(':issueId/links')
  @HttpCode(HttpStatus.OK)
  async getLinks(
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
  ) {
    return this.issuesService.getLinks(projectKey, issueId);
  }

  @Post(':issueId/create-bug')
  @HttpCode(HttpStatus.CREATED)
  async createBugFromStory(
    @Body() body: { title: string; priority?: string; description?: string },
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.issuesService.createBugFromStory(projectKey, issueId, body, userId);
  }

  @Get(':issueId/progress')
  @HttpCode(HttpStatus.OK)
  async getProgress(
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
  ) {
    return this.issuesService.getProgress(projectKey, issueId);
  }

  @Get(':issueId')
  @HttpCode(HttpStatus.OK)
  async findById(
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
  ) {
    return this.issuesService.findById(projectKey, issueId);
  }

  @Patch(':issueId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Body() body: UpdateIssueDto,
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.issuesService.update(projectKey, issueId, body, userId);
  }

  @Delete(':issueId')
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Body() body: { issueVersion: number },
    @Param('projectKey') projectKey: string,
    @Param('issueId') issueId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.userId;
    return this.issuesService.softDelete(projectKey, issueId, body.issueVersion, userId);
  }
}
