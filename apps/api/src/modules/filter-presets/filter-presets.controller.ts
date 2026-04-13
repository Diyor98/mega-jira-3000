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
import { FilterPresetsService } from './filter-presets.service';
import type { CreateFilterPresetInput } from '@mega-jira/shared';

@Controller('api/v1/projects/:projectKey/filter-presets')
export class FilterPresetsController {
  constructor(private readonly service: FilterPresetsService) {}

  private getUserId(req: Request): string {
    return (req as unknown as { user: { userId: string } }).user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectKey') projectKey: string,
    @Body() body: CreateFilterPresetInput,
    @Req() req: Request,
  ) {
    return this.service.create(projectKey, this.getUserId(req), body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('projectKey') projectKey: string,
    @Req() req: Request,
  ) {
    return this.service.list(projectKey, this.getUserId(req));
  }

  @Delete(':presetId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('projectKey') projectKey: string,
    @Param('presetId', new ParseUUIDPipe()) presetId: string,
    @Req() req: Request,
  ) {
    return this.service.delete(projectKey, this.getUserId(req), presetId);
  }
}
