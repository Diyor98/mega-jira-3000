import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { workflows } from '../../database/schema/workflows';
import { workflowStatuses } from '../../database/schema/workflow-statuses';
import { issues } from '../../database/schema/issues';
import { issueSequences } from '../../database/schema/issue-sequences';
import { createIssueSchema, type CreateIssueDto } from './dto/create-issue.dto';
import { updateIssueSchema, type UpdateIssueDto } from './dto/update-issue.dto';
import { createIssueLinkSchema, type CreateIssueLinkDto } from './dto/create-issue-link.dto';
import { issueLinks } from '../../database/schema/issue-links';

const PG_UNIQUE_VIOLATION = '23505';

const ISSUE_TYPE_DB_MAP: Record<string, string> = {
  Epic: 'epic',
  Story: 'story',
  Task: 'task',
  Bug: 'bug',
};

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async create(dto: CreateIssueDto, userId: string, projectKey: string) {
    const normalizedDto = {
      ...dto,
      title: typeof dto.title === 'string' ? dto.title.trim() : dto.title,
    };

    const validation = createIssueSchema.safeParse(normalizedDto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { title, type, priority, assigneeId, description, parentId } = validation.data;

    // Look up project
    const [project] = await this.db
      .select({ id: projects.id, key: projects.key })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    // Get default workflow's first status (Backlog)
    const [defaultWorkflow] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.projectId, project.id), eq(workflows.isDefault, true)))
      .limit(1);

    if (!defaultWorkflow) {
      throw new NotFoundException('Default workflow not found for project');
    }

    const [firstStatus] = await this.db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(eq(workflowStatuses.workflowId, defaultWorkflow.id))
      .orderBy(workflowStatuses.position)
      .limit(1);

    if (!firstStatus) {
      throw new NotFoundException('No workflow statuses found');
    }

    // Validate parent-child constraints
    if (parentId) {
      if (type === 'Epic') {
        throw new BadRequestException('Epics cannot be child issues');
      }
      const [parent] = await this.db
        .select({ id: issues.id, type: issues.type, projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, parentId), isNull(issues.deletedAt)))
        .limit(1);

      if (!parent) {
        throw new NotFoundException('Parent issue not found');
      }
      if (parent.type !== 'epic') {
        throw new BadRequestException('Only Epics can have child issues');
      }
      if (parent.projectId !== project.id) {
        throw new BadRequestException('Parent issue must be in the same project');
      }
    }

    // Generate sequential issue key inside transaction
    const issue = await this.db.transaction(async (tx) => {
      // Atomically get and increment sequence
      const [seq] = await tx
        .update(issueSequences)
        .set({ nextSequence: sql`${issueSequences.nextSequence} + 1` })
        .where(eq(issueSequences.projectId, project.id))
        .returning({ nextSequence: issueSequences.nextSequence });

      let sequence: number;
      if (seq) {
        sequence = seq.nextSequence - 1;
      } else {
        // First issue in project — upsert sequence row (handles concurrent first-issue race)
        const [upserted] = await tx
          .insert(issueSequences)
          .values({ projectId: project.id, nextSequence: 2 })
          .onConflictDoUpdate({
            target: issueSequences.projectId,
            set: { nextSequence: sql`${issueSequences.nextSequence} + 1` },
          })
          .returning({ nextSequence: issueSequences.nextSequence });
        sequence = upserted.nextSequence - 1;
      }

      const issueKey = `${project.key}-${sequence}`;

      const [newIssue] = await tx
        .insert(issues)
        .values({
          projectId: project.id,
          issueKey,
          title,
          description: description ?? null,
          type: ISSUE_TYPE_DB_MAP[type] as any,
          priority: priority ?? 'P3',
          statusId: firstStatus.id,
          assigneeId: assigneeId ?? null,
          reporterId: userId,
          parentId: parentId ?? null,
        })
        .returning({
          id: issues.id,
          issueKey: issues.issueKey,
          title: issues.title,
          description: issues.description,
          type: issues.type,
          priority: issues.priority,
          statusId: issues.statusId,
          assigneeId: issues.assigneeId,
          reporterId: issues.reporterId,
          parentId: issues.parentId,
          issueVersion: issues.issueVersion,
          createdAt: issues.createdAt,
        });

      return newIssue;
    });

    this.logger.log(`[AUDIT] issue.created | userId=${userId} | issueKey=${issue.issueKey}`);

    return issue;
  }

  async findByProject(projectKey: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    return this.db
      .select({
        id: issues.id,
        issueKey: issues.issueKey,
        title: issues.title,
        description: issues.description,
        type: issues.type,
        priority: issues.priority,
        statusId: issues.statusId,
        assigneeId: issues.assigneeId,
        reporterId: issues.reporterId,
        parentId: issues.parentId,
        issueVersion: issues.issueVersion,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .where(and(eq(issues.projectId, project.id), isNull(issues.deletedAt)));
  }

  async findById(projectKey: string, issueId: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [issue] = await this.db
      .select({
        id: issues.id,
        issueKey: issues.issueKey,
        title: issues.title,
        description: issues.description,
        type: issues.type,
        priority: issues.priority,
        statusId: issues.statusId,
        assigneeId: issues.assigneeId,
        reporterId: issues.reporterId,
        parentId: issues.parentId,
        issueVersion: issues.issueVersion,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, project.id),
          isNull(issues.deletedAt),
        ),
      )
      .limit(1);

    if (!issue) {
      throw new NotFoundException(`Issue not found`);
    }

    return issue;
  }

  async findChildren(projectKey: string, issueId: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    return this.db
      .select({
        id: issues.id,
        issueKey: issues.issueKey,
        title: issues.title,
        type: issues.type,
        priority: issues.priority,
        statusId: issues.statusId,
      })
      .from(issues)
      .where(
        and(
          eq(issues.parentId, issueId),
          eq(issues.projectId, project.id),
          isNull(issues.deletedAt),
        ),
      );
  }

  async getProgress(projectKey: string, issueId: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    // Count total children
    const [totalResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .where(
        and(
          eq(issues.parentId, issueId),
          eq(issues.projectId, project.id),
          isNull(issues.deletedAt),
        ),
      );

    const total = totalResult?.count ?? 0;

    // Count completed children (status name = 'Done')
    const [completedResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .innerJoin(workflowStatuses, eq(issues.statusId, workflowStatuses.id))
      .where(
        and(
          eq(issues.parentId, issueId),
          eq(issues.projectId, project.id),
          isNull(issues.deletedAt),
          eq(workflowStatuses.name, 'Done'),
        ),
      );

    const completed = completedResult?.count ?? 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, percentage };
  }

  async update(projectKey: string, issueId: string, dto: UpdateIssueDto, userId: string) {
    const validation = updateIssueSchema.safeParse(dto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { issueVersion, ...fieldsToUpdate } = validation.data;

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    // Build update data — only include fields that were provided
    const updateData: Record<string, unknown> = {
      issueVersion: sql`${issues.issueVersion} + 1`,
      updatedAt: new Date(),
    };

    const changedFields: string[] = [];
    if (fieldsToUpdate.title !== undefined) {
      updateData.title = fieldsToUpdate.title;
      changedFields.push('title');
    }
    if (fieldsToUpdate.priority !== undefined) {
      updateData.priority = fieldsToUpdate.priority;
      changedFields.push('priority');
    }
    if (fieldsToUpdate.description !== undefined) {
      updateData.description = fieldsToUpdate.description;
      changedFields.push('description');
    }
    if (fieldsToUpdate.assigneeId !== undefined) {
      updateData.assigneeId = fieldsToUpdate.assigneeId;
      changedFields.push('assigneeId');
    }
    if (fieldsToUpdate.parentId !== undefined) {
      // Validate parent constraints (same as create)
      if (fieldsToUpdate.parentId !== null) {
        const [parent] = await this.db
          .select({ id: issues.id, type: issues.type, projectId: issues.projectId })
          .from(issues)
          .where(and(eq(issues.id, fieldsToUpdate.parentId), isNull(issues.deletedAt)))
          .limit(1);

        if (!parent) {
          throw new NotFoundException('Parent issue not found');
        }
        if (parent.type !== 'epic') {
          throw new BadRequestException('Only Epics can have child issues');
        }
        if (parent.projectId !== project.id) {
          throw new BadRequestException('Parent issue must be in the same project');
        }
      }
      updateData.parentId = fieldsToUpdate.parentId;
      changedFields.push('parentId');
    }
    if (fieldsToUpdate.statusId !== undefined) {
      // Validate status belongs to project's workflow
      const [status] = await this.db
        .select({ id: workflowStatuses.id })
        .from(workflowStatuses)
        .innerJoin(workflows, eq(workflowStatuses.workflowId, workflows.id))
        .where(and(
          eq(workflowStatuses.id, fieldsToUpdate.statusId),
          eq(workflows.projectId, project.id),
        ))
        .limit(1);

      if (!status) {
        throw new BadRequestException('Invalid status for this project');
      }
      updateData.statusId = fieldsToUpdate.statusId;
      changedFields.push('statusId');
    }

    // No-op guard: if no fields changed, return current issue without updating
    if (changedFields.length === 0) {
      return this.findById(projectKey, issueId);
    }

    const [updated] = await this.db
      .update(issues)
      .set(updateData)
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, project.id),
          eq(issues.issueVersion, issueVersion),
          isNull(issues.deletedAt),
        ),
      )
      .returning({
        id: issues.id,
        issueKey: issues.issueKey,
        title: issues.title,
        description: issues.description,
        type: issues.type,
        priority: issues.priority,
        statusId: issues.statusId,
        assigneeId: issues.assigneeId,
        reporterId: issues.reporterId,
        parentId: issues.parentId,
        issueVersion: issues.issueVersion,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
      });

    if (!updated) {
      throw new ConflictException('Issue was modified by another user. Please refresh and try again.');
    }

    this.logger.log(`[AUDIT] issue.updated | userId=${userId} | issueKey=${updated.issueKey} | fields=[${changedFields.join(',')}]`);

    return updated;
  }

  async createLink(projectKey: string, issueId: string, dto: CreateIssueLinkDto, userId: string) {
    const validation = createIssueLinkSchema.safeParse(dto);
    if (!validation.success) {
      const message = validation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    const { targetIssueId, linkType } = validation.data;

    if (issueId === targetIssueId) {
      throw new BadRequestException('Cannot link an issue to itself');
    }

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    // Verify both issues exist in the project
    const [source] = await this.db
      .select({ id: issues.id, issueKey: issues.issueKey })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.projectId, project.id), isNull(issues.deletedAt)))
      .limit(1);

    if (!source) {
      throw new NotFoundException('Source issue not found');
    }

    const [target] = await this.db
      .select({ id: issues.id, issueKey: issues.issueKey })
      .from(issues)
      .where(and(eq(issues.id, targetIssueId), eq(issues.projectId, project.id), isNull(issues.deletedAt)))
      .limit(1);

    if (!target) {
      throw new NotFoundException('Target issue not found');
    }

    let link;
    try {
      [link] = await this.db
        .insert(issueLinks)
        .values({
          sourceIssueId: issueId,
          targetIssueId,
          linkType: linkType as any,
          createdBy: userId,
        })
        .returning({
          id: issueLinks.id,
          sourceIssueId: issueLinks.sourceIssueId,
          targetIssueId: issueLinks.targetIssueId,
          linkType: issueLinks.linkType,
          createdAt: issueLinks.createdAt,
        });
    } catch (error: unknown) {
      const pgError = error as { code?: string; cause?: { code?: string } };
      if (pgError.code === PG_UNIQUE_VIOLATION || pgError.cause?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('This link already exists');
      }
      throw error;
    }

    this.logger.log(`[AUDIT] issueLink.created | userId=${userId} | source=${source.issueKey} | target=${target.issueKey} | type=${linkType}`);

    return link;
  }

  async getLinks(projectKey: string, issueId: string) {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    // Verify issue belongs to this project
    const [issue] = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.projectId, project.id), isNull(issues.deletedAt)))
      .limit(1);

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    // Get all links where this issue is source or target
    const links = await this.db
      .select({
        id: issueLinks.id,
        sourceIssueId: issueLinks.sourceIssueId,
        targetIssueId: issueLinks.targetIssueId,
        linkType: issueLinks.linkType,
        createdAt: issueLinks.createdAt,
      })
      .from(issueLinks)
      .where(
        or(
          eq(issueLinks.sourceIssueId, issueId),
          eq(issueLinks.targetIssueId, issueId),
        ),
      );

    // Resolve the "other side" issue details
    const result = [];
    for (const link of links) {
      const linkedIssueId = link.sourceIssueId === issueId ? link.targetIssueId : link.sourceIssueId;
      const direction = link.sourceIssueId === issueId ? 'outgoing' : 'incoming';

      const [linkedIssue] = await this.db
        .select({
          id: issues.id,
          issueKey: issues.issueKey,
          title: issues.title,
          type: issues.type,
          priority: issues.priority,
          statusId: issues.statusId,
        })
        .from(issues)
        .where(and(eq(issues.id, linkedIssueId), isNull(issues.deletedAt)))
        .limit(1);

      if (linkedIssue) {
        result.push({
          linkId: link.id,
          linkType: link.linkType,
          direction,
          issue: linkedIssue,
        });
      }
    }

    return result;
  }

  async createBugFromStory(projectKey: string, storyIssueId: string, dto: { title: string; priority?: string; description?: string }, userId: string) {
    // Validate input
    const bugValidation = createIssueSchema.safeParse({ ...dto, type: 'Bug' });
    if (!bugValidation.success) {
      const message = bugValidation.error.issues.map((i: { message: string }) => i.message).join(', ');
      throw new BadRequestException(message);
    }

    // Verify source is a Story
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [story] = await this.db
      .select({ id: issues.id, issueKey: issues.issueKey, type: issues.type })
      .from(issues)
      .where(and(eq(issues.id, storyIssueId), eq(issues.projectId, project.id), isNull(issues.deletedAt)))
      .limit(1);

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.type !== 'story') {
      throw new BadRequestException('Can only create bugs from Story-type issues');
    }

    // Create Bug and auto-link atomically
    const bug = await this.create(
      { title: dto.title, type: 'Bug', priority: (dto.priority as any) ?? 'P3', description: dto.description },
      userId,
      projectKey,
    );

    // Auto-create link: Bug created_from Story
    try {
      await this.db.insert(issueLinks).values({
        sourceIssueId: bug.id,
        targetIssueId: storyIssueId,
        linkType: 'created_from' as any,
        createdBy: userId,
      });
    } catch {
      // Link creation failure should not prevent bug from being returned
      this.logger.warn(`[WARN] Failed to auto-link bug ${bug.issueKey} to story ${story.issueKey}`);
    }

    this.logger.log(`[AUDIT] bugFromStory | userId=${userId} | bug=${bug.issueKey} | story=${story.issueKey}`);

    return bug;
  }

  async softDelete(projectKey: string, issueId: string, issueVersion: number, userId: string) {
    if (!issueVersion || typeof issueVersion !== 'number' || issueVersion < 1) {
      throw new BadRequestException('issueVersion is required and must be a positive integer');
    }

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [deleted] = await this.db
      .update(issues)
      .set({
        deletedAt: new Date(),
        issueVersion: sql`${issues.issueVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, project.id),
          eq(issues.issueVersion, issueVersion),
          isNull(issues.deletedAt),
        ),
      )
      .returning({
        id: issues.id,
        issueKey: issues.issueKey,
        title: issues.title,
        type: issues.type,
        priority: issues.priority,
        issueVersion: issues.issueVersion,
        deletedAt: issues.deletedAt,
      });

    if (!deleted) {
      throw new ConflictException('Issue was modified by another user or already deleted.');
    }

    this.logger.log(`[AUDIT] issue.deleted | userId=${userId} | issueKey=${deleted.issueKey}`);

    return deleted;
  }
}
