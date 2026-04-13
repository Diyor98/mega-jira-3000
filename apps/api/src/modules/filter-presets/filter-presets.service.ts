import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { filterPresets } from '../../database/schema/filter-presets';
import {
  createFilterPresetSchema,
  type CreateFilterPresetInput,
} from '@mega-jira/shared';

@Injectable()
export class FilterPresetsService {
  private readonly logger = new Logger(FilterPresetsService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Today: project access === project ownership. When Epic 8 RBAC lands this
   * becomes a membership check. Duplicated from WorkflowService.assertOwnerAndLoadContext
   * by design — see story 5.2 dev notes.
   */
  private async assertProjectAccess(projectKey: string, userId: string) {
    const [project] = await this.db
      .select({ id: projects.id, key: projects.key, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this project');
    }
    return project;
  }

  async create(projectKey: string, userId: string, dto: CreateFilterPresetInput) {
    const parsed = createFilterPresetSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { name, filterConfig } = parsed.data;

    const project = await this.assertProjectAccess(projectKey, userId);

    let created;
    try {
      const [row] = await this.db
        .insert(filterPresets)
        .values({
          userId,
          projectId: project.id,
          name,
          filterConfig,
        })
        .returning({
          id: filterPresets.id,
          name: filterPresets.name,
          filterConfig: filterPresets.filterConfig,
          createdAt: filterPresets.createdAt,
        });
      created = row;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('A preset with this name already exists.');
      }
      throw e;
    }

    this.logger.log(
      `[AUDIT] filterPreset.created | userId=${userId} | projectKey=${project.key} | presetId=${created.id} | name=${created.name}`,
    );

    return created;
  }

  async list(projectKey: string, userId: string) {
    const project = await this.assertProjectAccess(projectKey, userId);

    const rows = await this.db
      .select({
        id: filterPresets.id,
        name: filterPresets.name,
        filterConfig: filterPresets.filterConfig,
        createdAt: filterPresets.createdAt,
      })
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.userId, userId),
          eq(filterPresets.projectId, project.id),
        ),
      )
      .orderBy(asc(filterPresets.name));

    return rows;
  }

  async delete(projectKey: string, userId: string, presetId: string) {
    const project = await this.assertProjectAccess(projectKey, userId);

    // Scope by (id, user_id) so another user's preset returns 404, not 403 —
    // avoids leaking existence (see story 5.2 dev notes).
    const [target] = await this.db
      .select({ id: filterPresets.id, name: filterPresets.name })
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.id, presetId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.projectId, project.id),
        ),
      )
      .limit(1);

    if (!target) {
      throw new NotFoundException('Preset not found');
    }

    // Defense in depth: mirror the full (id, userId, projectId) scope on the
    // DELETE itself so a TOCTOU race with a swapped projectId can't erase a
    // row the SELECT guard already validated.
    const deleted = await this.db
      .delete(filterPresets)
      .where(
        and(
          eq(filterPresets.id, presetId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.projectId, project.id),
        ),
      )
      .returning({ id: filterPresets.id });

    if (deleted.length === 0) {
      // Raced with a concurrent delete — no audit line, still report success.
      return { id: presetId, deleted: true };
    }

    this.logger.log(
      `[AUDIT] filterPreset.deleted | userId=${userId} | projectKey=${project.key} | presetId=${presetId} | name=${target.name}`,
    );

    return { id: presetId, deleted: true };
  }
}
