import {
  Controller,
  Post,
  Get,
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
import type { AddRuleDto } from './dto/add-rule.dto';

@Controller('api/v1/projects/:projectKey/workflow/rules')
export class WorkflowRulesController {
  constructor(private readonly workflowService: WorkflowService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addRule(
    @Param('projectKey') projectKey: string,
    @Body() body: AddRuleDto,
    @Req() req: Request,
  ) {
    return this.workflowService.addRule(projectKey, this.getUserId(req), body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listRules(
    @Param('projectKey') projectKey: string,
    @Req() req: Request,
  ) {
    return this.workflowService.listRules(projectKey, this.getUserId(req));
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.OK)
  async deleteRule(
    @Param('projectKey') projectKey: string,
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Req() req: Request,
  ) {
    return this.workflowService.deleteRule(projectKey, this.getUserId(req), ruleId);
  }
}
