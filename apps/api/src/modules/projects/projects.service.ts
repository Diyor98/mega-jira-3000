import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit.service';
import { eq, and, or, sql } from 'drizzle-orm';
import { DEFAULT_WORKFLOW_STATUSES } from '@mega-jira/shared';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { workflows } from '../../database/schema/workflows';
import { workflowStatuses } from '../../database/schema/workflow-statuses';
import { projectMembers } from '../../database/schema/project-members';
import { createProjectSchema, type CreateProjectDto } from './dto/create-project.dto';
import { updateProjectSchema, type UpdateProjectDto } from './dto/update-project.dto';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async create(dto: CreateProjectDto, userId: string) {
    const normalizedDto = {
      ...dto,
      key: typeof dto.key === 'string' ? dto.key.trim().toUpperCase() : dto.key,
      name: typeof dto.name === 'string' ? dto.name.trim() : dto.name,
    };

    const validation = createProjectSchema.safeParse(normalizedDto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { name, key } = validation.data;

    let project;
    try {
      project = await this.db.transaction(async (tx) => {
        const [newProject] = await tx
          .insert(projects)
          .values({ name, key, ownerId: userId })
          .returning({
            id: projects.id,
            name: projects.name,
            key: projects.key,
            ownerId: projects.ownerId,
            createdAt: projects.createdAt,
          });

        const [workflow] = await tx
          .insert(workflows)
          .values({ projectId: newProject.id, name: 'Default', isDefault: true })
          .returning({ id: workflows.id });

        await tx.insert(workflowStatuses).values(
          DEFAULT_WORKFLOW_STATUSES.map((statusName, i) => ({
            workflowId: workflow.id,
            name: statusName,
            position: i + 1,
          })),
        );

        // Story 8.1: auto-enroll the creator as project_admin so the
        // member-list UI reflects reality and Story 8.2's enforcement has
        // a row to resolve against. Stays inside this transaction so a
        // partial create never leaves a project without any members.
        await tx.insert(projectMembers).values({
          projectId: newProject.id,
          userId,
          role: 'project_admin',
          addedBy: userId,
        });

        return newProject;
      });
    } catch (error: unknown) {
      const pgError = error as { code?: string; cause?: { code?: string } };
      if (pgError.code === PG_UNIQUE_VIOLATION || pgError.cause?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Project key already in use');
      }
      throw error;
    }

    this.logger.log(`[AUDIT] project.created | userId=${userId} | projectKey=${project.key}`);

    await this.auditLog?.record({
      projectId: (project as unknown as { id: string }).id,
      actorId: userId,
      entityType: 'project',
      entityId: (project as unknown as { id: string }).id,
      action: 'created',
      after: { key: (project as unknown as { key: string }).key, name: (project as unknown as { name: string }).name },
    });

    return project;
  }

  /**
   * Story 8.2: returns every project the caller can access — owner OR a row
   * in `project_members`. The owner clause stays for the transitional safety
   * net (Story 8.1 backfilled member rows for every owner; the OR keeps a
   * legacy owner with a missing member row from being locked out).
   */
  async findAccessible(userId: string) {
    return this.db
      .select({
        id: projects.id,
        name: projects.name,
        key: projects.key,
        description: projects.description,
        ownerId: projects.ownerId,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(
        or(
          eq(projects.ownerId, userId),
          sql`EXISTS (SELECT 1 FROM ${projectMembers} WHERE ${projectMembers.projectId} = ${projects.id} AND ${projectMembers.userId} = ${userId})`,
        ),
      );
  }

  /** @deprecated use `findAccessible` (Story 8.2 replaced ownership-only listing). */
  async findByOwner(userId: string) {
    return this.findAccessible(userId);
  }

  async updateMetadata(projectKey: string, dto: UpdateProjectDto, userId: string) {
    const validation = updateProjectSchema.safeParse(dto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }
    const patch = validation.data;

    const [existing] = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        key: projects.key,
        description: projects.description,
        ownerId: projects.ownerId,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const update: { name?: string; description?: string | null } = {};
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.description !== undefined) update.description = patch.description;

    const [updated] = await this.db
      .update(projects)
      .set(update)
      .where(eq(projects.id, existing.id))
      .returning({
        id: projects.id,
        name: projects.name,
        key: projects.key,
        description: projects.description,
        ownerId: projects.ownerId,
        createdAt: projects.createdAt,
      });

    this.logger.log(`[AUDIT] project.updated | userId=${userId} | projectKey=${projectKey}`);

    await this.auditLog?.record({
      projectId: existing.id,
      actorId: userId,
      entityType: 'project',
      entityId: existing.id,
      action: 'updated',
      before: { name: existing.name, description: existing.description },
      after: { name: updated.name, description: updated.description },
    });

    return updated;
  }

  async getStatuses(projectKey: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [defaultWorkflow] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.projectId, project.id), eq(workflows.isDefault, true)))
      .limit(1);

    if (!defaultWorkflow) {
      return [];
    }

    return this.db
      .select({
        id: workflowStatuses.id,
        name: workflowStatuses.name,
        position: workflowStatuses.position,
      })
      .from(workflowStatuses)
      .where(eq(workflowStatuses.workflowId, defaultWorkflow.id))
      .orderBy(workflowStatuses.position);
  }
}
