import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { issues } from '../../database/schema/issues';
import { comments } from '../../database/schema/comments';
import { createCommentSchema, type CreateCommentInput } from '@mega-jira/shared';
import { EventService } from '../board/event.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly eventService: EventService,
  ) {}

  /**
   * Owner-gate + issue-scoping helper. Returns the project + resolved issue
   * key (for audit logging). Throws 404 if the issue is not in this project
   * or is soft-deleted, 403 if the caller does not own the project.
   */
  private async assertAccessAndLoadIssue(
    projectKey: string,
    issueId: string,
    userId: string,
  ) {
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

    const [issue] = await this.db
      .select({ id: issues.id, issueKey: issues.issueKey })
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
      throw new NotFoundException('Issue not found');
    }

    return { project, issue };
  }

  async create(
    projectKey: string,
    issueId: string,
    userId: string,
    dto: CreateCommentInput,
  ) {
    const parsed = createCommentSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { body } = parsed.data;

    const { project, issue } = await this.assertAccessAndLoadIssue(
      projectKey,
      issueId,
      userId,
    );

    const [row] = await this.db
      .insert(comments)
      .values({ issueId: issue.id, authorId: userId, body })
      .returning({
        id: comments.id,
        issueId: comments.issueId,
        authorId: comments.authorId,
        body: comments.body,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      });

    this.logger.log(
      `[AUDIT] comment.created | userId=${userId} | projectKey=${project.key} | issueKey=${issue.issueKey} | commentId=${row.id}`,
    );

    this.eventService.emitCommentCreated(project.key, {
      issueId: issue.id,
      comment: row as unknown as Record<string, unknown>,
      actorId: userId,
      timestamp: new Date().toISOString(),
    });

    return row;
  }

  async listByIssue(projectKey: string, issueId: string, userId: string) {
    const { issue } = await this.assertAccessAndLoadIssue(projectKey, issueId, userId);

    const rows = await this.db
      .select({
        id: comments.id,
        issueId: comments.issueId,
        authorId: comments.authorId,
        body: comments.body,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .where(and(eq(comments.issueId, issue.id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));

    return rows;
  }
}
