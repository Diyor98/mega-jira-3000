import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { eq, and, or, isNull, inArray, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { workflows } from '../../database/schema/workflows';
import { workflowStatuses } from '../../database/schema/workflow-statuses';
import { workflowRules } from '../../database/schema/workflow-rules';
import { issues } from '../../database/schema/issues';
import { WorkflowRuleViolationException } from '../../common/exceptions/workflow-rule-violation.exception';
import { issueSequences } from '../../database/schema/issue-sequences';
import { createIssueSchema, type CreateIssueDto } from './dto/create-issue.dto';
import { updateIssueSchema, type UpdateIssueDto } from './dto/update-issue.dto';
import { issueListQuerySchema, type IssueListQuery } from '@mega-jira/shared';
import { createIssueLinkSchema, type CreateIssueLinkDto } from './dto/create-issue-link.dto';
import { issueLinks } from '../../database/schema/issue-links';
import { EventService } from '../board/event.service';
import { NotificationsService, type NotificationInsertRow } from '../notifications/notifications.service';
import { AuditLogService } from '../audit/audit.service';
import { resolveRetentionDays } from '../lifecycle/data-lifecycle.service';

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

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly eventService: EventService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

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

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'issue',
      entityId: (issue as unknown as { id: string }).id,
      action: 'created',
      after: {
        issueKey: issue.issueKey,
        title: issue.title,
        type: issue.type,
        priority: issue.priority,
        statusId: issue.statusId,
        assigneeId: issue.assigneeId,
      },
    });

    // Story 6.3: if the new issue was created with an initial assignee who is
    // not the reporter, notify them.
    const createdIssue = issue as unknown as { id: string; assigneeId: string | null };
    if (createdIssue.assigneeId && createdIssue.assigneeId !== userId) {
      await this.notificationsService.createBulk(this.db, [
        {
          userId: createdIssue.assigneeId,
          type: 'assigned',
          issueId: createdIssue.id,
          actorId: userId,
        },
      ]);
    }

    this.eventService.emitIssueCreated(projectKey, {
      issue: issue as unknown as Record<string, unknown>,
      actorId: userId,
      timestamp: new Date().toISOString(),
    });

    return issue;
  }

  async findByProject(projectKey: string, rawQuery: unknown = {}) {
    const parsed = issueListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const query: IssueListQuery = parsed.data;

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const conditions: SQL[] = [
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt),
    ];

    if (query.statusId && query.statusId.length > 0) {
      conditions.push(inArray(issues.statusId, query.statusId));
    }

    if (query.assigneeId && query.assigneeId.length > 0) {
      const includesUnassigned = query.assigneeId.includes('unassigned');
      const uuids = query.assigneeId.filter((v) => v !== 'unassigned');
      if (includesUnassigned && uuids.length > 0) {
        conditions.push(or(isNull(issues.assigneeId), inArray(issues.assigneeId, uuids))!);
      } else if (includesUnassigned) {
        conditions.push(isNull(issues.assigneeId));
      } else if (uuids.length > 0) {
        // Defense in depth: only call inArray when the list is non-empty.
        // (The Zod schema + parse-time filter already guarantee this, but
        // Drizzle's inArray([]) behavior varies by version, so guard locally.)
        conditions.push(inArray(issues.assigneeId, uuids));
      }
    }

    if (query.type && query.type.length > 0) {
      conditions.push(inArray(issues.type, query.type));
    }

    if (query.priority && query.priority.length > 0) {
      conditions.push(inArray(issues.priority, query.priority));
    }

    if (query.createdFrom) {
      conditions.push(gte(issues.createdAt, new Date(`${query.createdFrom}T00:00:00.000Z`)));
    }

    if (query.createdTo) {
      // Widen to end-of-day so users get inclusive upper-bound semantics.
      conditions.push(lte(issues.createdAt, new Date(`${query.createdTo}T23:59:59.999Z`)));
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
      .where(and(...conditions))
      .orderBy(desc(issues.createdAt));
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
        resolution: issues.resolution,
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
          // FRAGILE: hardcoded "Done" name; admins can rename via Story 4.1. Replace with a status_category column when needed (deferred).
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
    if (fieldsToUpdate.resolution !== undefined) {
      // Spec AC #10: `resolution` is only settable via the WorkflowPrompt on a
      // transition. Reject direct PATCHes that try to set it without a
      // concurrent status change. Reopen auto-clears still work because that
      // path writes `updateData.resolution = null` inside the transaction
      // after this dispatch block.
      if (fieldsToUpdate.statusId === undefined) {
        throw new BadRequestException(
          'resolution can only be set as part of a status transition',
        );
      }
      updateData.resolution = fieldsToUpdate.resolution;
      changedFields.push('resolution');
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
    // Resolve the target workflow id + status name up-front when statusId is
    // changing so we can validate + match the FR20 reopen rule by literal name.
    let targetWorkflowId: string | null = null;
    let targetStatusName: string | null = null;
    if (fieldsToUpdate.statusId !== undefined) {
      const [status] = await this.db
        .select({
          id: workflowStatuses.id,
          name: workflowStatuses.name,
          workflowId: workflowStatuses.workflowId,
        })
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
      targetWorkflowId = status.workflowId;
      targetStatusName = status.name;
      updateData.statusId = fieldsToUpdate.statusId;
      changedFields.push('statusId');
    }

    // No-op guard: if no fields changed, return current issue without updating
    if (changedFields.length === 0) {
      return this.findById(projectKey, issueId);
    }

    // Story 6.3: snapshot pre-update assigneeId so the notification trigger
    // can detect whether the value actually changed (a PATCH re-sending the
    // same assigneeId must not fire a spurious notification).
    let previousAssigneeId: string | null = null;
    if (fieldsToUpdate.assigneeId !== undefined) {
      const [pre] = await this.db
        .select({ assigneeId: issues.assigneeId })
        .from(issues)
        .where(
          and(
            eq(issues.id, issueId),
            eq(issues.projectId, project.id),
            isNull(issues.deletedAt),
          ),
        )
        .limit(1);
      previousAssigneeId = pre?.assigneeId ?? null;
    }

    const returningCols = {
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
      resolution: issues.resolution,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
    };

    let updated: typeof returningCols extends object ? any : never;

    let reopenedFromDone = false;

    if (fieldsToUpdate.statusId !== undefined && targetWorkflowId) {
      // ---- Workflow rule enforcement (FR17/FR18) + FR20 reopen ----
      // Wraps the current-state load, rule check, and optimistic UPDATE in a
      // single transaction with SELECT ... FOR UPDATE on the issue row so
      // concurrent PATCHes can't clear required fields between the check and
      // the UPDATE. Rule enforcement still runs BEFORE the UPDATE so
      // `issueVersion` is NOT incremented on violation.
      updated = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from issues where id = ${issueId} and project_id = ${project.id} and deleted_at is null for update`,
        );

        const [currentIssue] = await tx
          .select({
            statusId: issues.statusId,
            assigneeId: issues.assigneeId,
            resolution: issues.resolution,
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

        if (!currentIssue) {
          throw new NotFoundException('Issue not found');
        }

        // Look up the *current* status name for the FR20 reopen check.
        const [currentStatusRow] = await tx
          .select({ name: workflowStatuses.name })
          .from(workflowStatuses)
          .where(eq(workflowStatuses.id, currentIssue.statusId))
          .limit(1);
        const currentStatusName = currentStatusRow?.name ?? '';

        const matchingRules = await tx
          .select({
            id: workflowRules.id,
            fromStatusId: workflowRules.fromStatusId,
            toStatusId: workflowRules.toStatusId,
            ruleType: workflowRules.ruleType,
            requiredField: workflowRules.requiredField,
          })
          .from(workflowRules)
          .where(
            and(
              eq(workflowRules.workflowId, targetWorkflowId),
              eq(workflowRules.toStatusId, fieldsToUpdate.statusId!),
              or(
                isNull(workflowRules.fromStatusId),
                eq(workflowRules.fromStatusId, currentIssue.statusId),
              ),
            ),
          )
          .orderBy(workflowRules.createdAt);

        for (const rule of matchingRules) {
          if (rule.ruleType === 'require_assignee') {
            const resultingAssigneeId =
              fieldsToUpdate.assigneeId !== undefined
                ? fieldsToUpdate.assigneeId
                : currentIssue.assigneeId;

            if (resultingAssigneeId === null || resultingAssigneeId === undefined) {
              this.logger.warn(
                `[AUDIT] workflowRule.violation | userId=${userId} | issueId=${issueId} | ruleType=${rule.ruleType} | requiredField=assigneeId | toStatusId=${rule.toStatusId}`,
              );
              throw new WorkflowRuleViolationException(
                'Transition blocked: assignee required',
                {
                  id: rule.id,
                  ruleType: rule.ruleType,
                  requiredField: 'assigneeId',
                  fromStatusId: rule.fromStatusId,
                  toStatusId: rule.toStatusId,
                },
              );
            }
          } else if (rule.ruleType === 'require_field') {
            const field = rule.requiredField;
            if (!field) continue; // defensive: schema should guarantee non-null
            let resultingValue: string | null | undefined;
            if (field === 'resolution') {
              resultingValue =
                fieldsToUpdate.resolution !== undefined
                  ? fieldsToUpdate.resolution
                  : currentIssue.resolution;
            } else {
              // Unknown field names should be unreachable via normal API
              // writes (the Zod enum only permits 'resolution'), but a
              // hand-edited DB row could still have something else. Warn loudly
              // instead of silently ignoring it so operators notice.
              this.logger.warn(
                `[AUDIT] workflowRule.unknownField | ruleId=${rule.id} | requiredField=${field} | toStatusId=${rule.toStatusId}`,
              );
              continue;
            }

            const nonEmpty =
              typeof resultingValue === 'string' && resultingValue.trim().length > 0;

            if (!nonEmpty) {
              this.logger.warn(
                `[AUDIT] workflowRule.violation | userId=${userId} | issueId=${issueId} | ruleType=${rule.ruleType} | requiredField=${field} | toStatusId=${rule.toStatusId}`,
              );
              throw new WorkflowRuleViolationException(
                `Transition blocked: ${field} required`,
                {
                  id: rule.id,
                  ruleType: rule.ruleType,
                  requiredField: field,
                  fromStatusId: rule.fromStatusId,
                  toStatusId: rule.toStatusId,
                },
              );
            }
          }
        }

        // FR20: reopen from Done clears resolution + resets status_changed_at.
        // FRAGILE: hardcoded literal "Done" — replace with a status_category
        // column when available (inherited caveat from Story 4.1).
        if (currentStatusName === 'Done' && targetStatusName !== 'Done') {
          reopenedFromDone = true;
          updateData.resolution = null;
        }
        // Time-in-status resets on EVERY status change (not just reopens).
        updateData.statusChangedAt = new Date();

        const [row] = await tx
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
          .returning(returningCols);
        return row;
      });
    } else {
      [updated] = await this.db
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
        .returning(returningCols);
    }

    if (!updated) {
      this.logger.warn(`[AUDIT] issue.conflict | userId=${userId} | issueId=${issueId} | sentVersion=${issueVersion}`);
      throw new ConflictException('Issue was modified by another user. Please refresh and try again.');
    }

    this.logger.log(`[AUDIT] issue.updated | userId=${userId} | issueKey=${updated.issueKey} | fields=[${changedFields.join(',')}]`);

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'issue',
      entityId: updated.id,
      action: 'updated',
      after: changedFields.reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (updated as Record<string, unknown>)[k];
        return acc;
      }, { issueKey: updated.issueKey, changedFields }),
    });

    // Story 6.3 triggers: build a recipient set for assigned / status_changed
    // notifications. Best-effort — any failure is swallowed inside
    // `createBulk` so the update's primary result is unaffected.
    const notifyRows: NotificationInsertRow[] = [];
    // Value-change guard: a PATCH that re-sends the same assigneeId must not
    // fire a spurious notification. `previousAssigneeId` was loaded in the
    // pre-update fetch just above the optimistic UPDATE.
    if (
      changedFields.includes('assigneeId') &&
      updated.assigneeId &&
      updated.assigneeId !== userId &&
      updated.assigneeId !== previousAssigneeId
    ) {
      notifyRows.push({
        userId: updated.assigneeId,
        type: 'assigned',
        issueId: updated.id,
        actorId: userId,
      });
    }
    if (changedFields.includes('statusId')) {
      const recipients = new Set<string>();
      if (updated.reporterId && updated.reporterId !== userId) {
        recipients.add(updated.reporterId);
      }
      if (updated.assigneeId && updated.assigneeId !== userId) {
        recipients.add(updated.assigneeId);
      }
      for (const recipient of recipients) {
        notifyRows.push({
          userId: recipient,
          type: 'status_changed',
          issueId: updated.id,
          actorId: userId,
        });
      }
    }
    if (notifyRows.length > 0) {
      await this.notificationsService.createBulk(this.db, notifyRows);
    }

    if (reopenedFromDone) {
      this.logger.log(
        `[AUDIT] issue.reopened | userId=${userId} | issueKey=${updated.issueKey} | fromStatus=Done | toStatus=${targetStatusName}`,
      );
    }

    const BROADCASTABLE_FIELDS = ['title', 'description', 'type', 'priority', 'statusId', 'assigneeId', 'reporterId', 'parentId', 'resolution'] as const;
    type BroadcastField = typeof BROADCASTABLE_FIELDS[number];
    const timestamp = new Date().toISOString();

    if (changedFields.includes('statusId')) {
      this.eventService.emitIssueMoved(projectKey, {
        issueId: updated.id,
        statusId: updated.statusId,
        issueVersion: updated.issueVersion,
        actorId: userId,
        timestamp,
      });
    }

    const otherChangedFields = changedFields.filter(
      (f): f is BroadcastField => f !== 'statusId' && (BROADCASTABLE_FIELDS as readonly string[]).includes(f),
    );
    if (otherChangedFields.length > 0) {
      const fields: Record<string, unknown> = {};
      for (const f of otherChangedFields) {
        fields[f] = updated[f];
      }
      this.eventService.emitIssueUpdated(projectKey, {
        issueId: updated.id,
        fields,
        actorId: userId,
        timestamp,
      });
    }

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
      this.logger.warn(`[AUDIT] issue.conflict | userId=${userId} | issueId=${issueId} | sentVersion=${issueVersion}`);
      throw new ConflictException('Issue was modified by another user or already deleted.');
    }

    this.logger.log(`[AUDIT] issue.deleted | userId=${userId} | issueKey=${deleted.issueKey}`);

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'issue',
      entityId: deleted.id,
      action: 'deleted',
      before: {
        issueKey: deleted.issueKey,
        title: deleted.title,
        type: deleted.type,
        priority: deleted.priority,
      },
    });

    this.eventService.emitIssueDeleted(projectKey, {
      issueId: deleted.id,
      actorId: userId,
      timestamp: new Date().toISOString(),
    });

    return deleted;
  }

  /**
   * Story 7.2: restore a soft-deleted issue if it's still inside the 30-day
   * retention window. Clears `deletedAt`, bumps `issueVersion`, emits
   * `issue.restored` WS event.
   */
  async restore(projectKey: string, issueId: string, userId: string) {
    // Shared parser — throws on invalid env, same behavior as the cron.
    // Previously used raw `Number(process.env.…)` which coerced bad values
    // to NaN and silently made the window check always-false.
    const retentionDays = resolveRetentionDays();

    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [current] = await this.db
      .select({
        id: issues.id,
        issueKey: issues.issueKey,
        deletedAt: issues.deletedAt,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.projectId, project.id)))
      .limit(1);

    if (!current) {
      throw new NotFoundException('Issue not found');
    }
    if (current.deletedAt === null) {
      throw new ConflictException({ code: 'NotDeleted', message: 'Issue is not deleted' });
    }
    const ageMs = Date.now() - current.deletedAt.getTime();
    if (ageMs > retentionDays * 86_400_000) {
      throw new ConflictException({
        code: 'RestoreWindowExpired',
        message: 'This issue can no longer be restored.',
      });
    }

    const [restored] = await this.db
      .update(issues)
      .set({
        deletedAt: null,
        issueVersion: sql`${issues.issueVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.projectId, project.id),
          // Scope the UPDATE to still-soft-deleted rows only — a concurrent
          // hard-delete / cron purge would leave `restored` undefined and
          // the logger line below would crash (review finding M1).
          sql`${issues.deletedAt} is not null`,
        ),
      )
      .returning({
        id: issues.id,
        issueKey: issues.issueKey,
        issueVersion: issues.issueVersion,
      });

    if (!restored) {
      throw new NotFoundException('Issue no longer exists');
    }

    this.logger.log(`[AUDIT] issue.restored | userId=${userId} | issueKey=${restored.issueKey}`);

    await this.auditLog?.record({
      projectId: project.id,
      actorId: userId,
      entityType: 'issue',
      entityId: restored.id,
      action: 'restored',
      after: { issueKey: restored.issueKey, issueVersion: restored.issueVersion },
    });

    this.eventService.emitIssueRestored(projectKey, {
      issueId: restored.id,
      actorId: userId,
      timestamp: new Date().toISOString(),
    });

    return restored;
  }
}
