import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, or, asc, isNull, inArray, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { issues } from '../../database/schema/issues';
import { comments } from '../../database/schema/comments';
import { commentMentions } from '../../database/schema/comment-mentions';
import { users } from '../../database/schema/users';
import { createCommentSchema, type CreateCommentInput } from '@mega-jira/shared';
import { EventService } from '../board/event.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Parses `@handle` mentions out of a Markdown comment body. Returns unique,
 * lowercased handles. The leading `(?:^|[^a-z0-9._-])` prefix prevents
 * matches inside email addresses (`foo@bar.com`), code-like tokens, etc.
 * Exported for unit tests.
 */
export function extractMentions(body: string): string[] {
  const regex = /(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi;
  const handles = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    // Strip trailing punctuation (`.`, `-`, `_`) that the char class allows
    // in the middle of a handle but which is almost always sentence-ending
    // punctuation at the tail. E.g. `@carol.` → `carol`, `@alice.bob.` → `alice.bob`.
    const handle = match[1].toLowerCase().replace(/[._-]+$/, '');
    if (handle.length > 0) handles.add(handle);
  }
  return Array.from(handles);
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly eventService: EventService,
    private readonly notificationsService: NotificationsService,
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

    const handles = extractMentions(body);

    // Wrap comment insert + mention resolution + mention inserts in a single
    // transaction so any failure rolls back the whole comment.
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
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

      let mentions: Array<{ userId: string; email: string }> = [];
      if (handles.length > 0) {
        // Resolve handles to user rows via lower(split_part(email, '@', 1)).
        // NOT using sql`any(...)` — see Story 4.2 `addRule` footgun. Build
        // an or(...) chain of eq() per handle instead.
        const handleConditions = handles.map((h) =>
          eq(sql`lower(split_part(${users.email}, '@', 1))`, h),
        );
        const resolved = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(or(...handleConditions));

        if (resolved.length > 0) {
          await tx
            .insert(commentMentions)
            .values(
              resolved.map((u) => ({ commentId: row.id, mentionedUserId: u.id })),
            )
            .onConflictDoNothing();
          mentions = resolved.map((u) => ({ userId: u.id, email: u.email }));
        }
      }

      return { ...row, mentions };
    });

    // Story 6.3: notify each mentioned user except the author. Runs AFTER the
    // tx commits so `createBulk`'s fail-soft swallow can't leave the tx in an
    // aborted state (see Story 6.3 code review). If the notification insert
    // fails, the comment still exists — that's the fail-soft intent.
    const notifyRows = result.mentions
      .filter((m) => m.userId !== userId)
      .map((m) => ({
        userId: m.userId,
        type: 'mentioned' as const,
        issueId: issue.id,
        commentId: result.id,
        actorId: userId,
      }));
    if (notifyRows.length > 0) {
      await this.notificationsService.createBulk(this.db, notifyRows);
    }

    this.logger.log(
      `[AUDIT] comment.created | userId=${userId} | projectKey=${project.key} | issueKey=${issue.issueKey} | commentId=${result.id} | mentionCount=${result.mentions.length}`,
    );

    this.eventService.emitCommentCreated(project.key, {
      issueId: issue.id,
      comment: result as unknown as Record<string, unknown>,
      actorId: userId,
      timestamp: new Date().toISOString(),
    });

    return result;
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

    if (rows.length === 0) return [];

    // Second round-trip for all mentions across the loaded comments, grouped
    // in memory. Cheaper than a LEFT JOIN for the fanout pattern (N comments
    // × M mentions each) at MVP scale.
    const commentIds = rows.map((r) => r.id);
    const mentionRows = await this.db
      .select({
        commentId: commentMentions.commentId,
        userId: commentMentions.mentionedUserId,
        email: users.email,
      })
      .from(commentMentions)
      .innerJoin(users, eq(commentMentions.mentionedUserId, users.id))
      .where(inArray(commentMentions.commentId, commentIds));

    const mentionsByComment = new Map<
      string,
      Array<{ userId: string; email: string }>
    >();
    for (const m of mentionRows) {
      const arr = mentionsByComment.get(m.commentId) ?? [];
      arr.push({ userId: m.userId, email: m.email });
      mentionsByComment.set(m.commentId, arr);
    }

    return rows.map((r) => ({
      ...r,
      mentions: mentionsByComment.get(r.id) ?? [],
    }));
  }
}
