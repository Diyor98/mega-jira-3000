import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { workflows } from '../../database/schema/workflows';
import { workflowStatuses } from '../../database/schema/workflow-statuses';
import { workflowRules } from '../../database/schema/workflow-rules';
import { issues } from '../../database/schema/issues';
import { addStatusSchema, type AddStatusDto } from './dto/add-status.dto';
import { updateStatusSchema, type UpdateStatusDto } from './dto/update-status.dto';
import { moveIssuesSchema, type MoveIssuesDto } from './dto/move-issues.dto';
import { addRuleSchema, type AddRuleDto } from './dto/add-rule.dto';

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // -------------- helpers --------------

  /** Throws ForbiddenException if the caller does not own the project. Returns the project + default workflow. */
  private async assertOwnerAndLoadContext(projectKey: string, userId: string) {
    const [project] = await this.db
      .select({ id: projects.id, key: projects.key, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('Only the project owner can modify workflow statuses');
    }

    const [workflow] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.projectId, project.id), eq(workflows.isDefault, true)))
      .limit(1);

    if (!workflow) {
      throw new NotFoundException('Default workflow not found for project');
    }

    return { project, workflow };
  }

  // -------------- add --------------

  async addStatus(projectKey: string, userId: string, dto: AddStatusDto) {
    const validation = addStatusSchema.safeParse(dto);
    if (!validation.success) {
      throw new BadRequestException(
        validation.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { name } = validation.data;

    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    // Wrap dup-check + MAX(position) read + INSERT in a single transaction with
    // a row lock on the parent workflow row to serialize concurrent addStatus
    // calls and prevent TOCTOU duplicate-position races.
    const created = await this.db.transaction(async (tx) => {
      // Lock the workflow row for the duration of this transaction
      await tx.execute(sql`select id from workflows where id = ${workflow.id} for update`);

      // Case-insensitive duplicate check
      const existing = await tx
        .select({ id: workflowStatuses.id })
        .from(workflowStatuses)
        .where(
          and(
            eq(workflowStatuses.workflowId, workflow.id),
            sql`lower(${workflowStatuses.name}) = lower(${name})`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException('A status with this name already exists.');
      }

      // Next position = MAX(position) + 1 (or 1 if none)
      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${workflowStatuses.position}), 0)::int` })
        .from(workflowStatuses)
        .where(eq(workflowStatuses.workflowId, workflow.id));

      const nextPosition = (maxRow?.max ?? 0) + 1;

      const [row] = await tx
        .insert(workflowStatuses)
        .values({ workflowId: workflow.id, name, position: nextPosition })
        .returning({
          id: workflowStatuses.id,
          name: workflowStatuses.name,
          position: workflowStatuses.position,
        });
      return row;
    });

    this.logger.log(
      `[AUDIT] workflowStatus.added | userId=${userId} | projectKey=${project.key} | statusId=${created.id} | name=${created.name}`,
    );

    return created;
  }

  // -------------- rename / reorder --------------

  async updateStatus(
    projectKey: string,
    userId: string,
    statusId: string,
    dto: UpdateStatusDto,
  ) {
    const validation = updateStatusSchema.safeParse(dto);
    if (!validation.success) {
      throw new BadRequestException(
        validation.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { name, position } = validation.data;

    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    // Verify the status belongs to this project's workflow
    const [target] = await this.db
      .select({
        id: workflowStatuses.id,
        name: workflowStatuses.name,
        position: workflowStatuses.position,
      })
      .from(workflowStatuses)
      .where(
        and(eq(workflowStatuses.id, statusId), eq(workflowStatuses.workflowId, workflow.id)),
      )
      .limit(1);

    if (!target) {
      throw new NotFoundException('Status not found in this project workflow');
    }

    // Rename
    if (name !== undefined && name !== target.name) {
      // duplicate check (case-insensitive, excluding self)
      const duplicate = await this.db
        .select({ id: workflowStatuses.id })
        .from(workflowStatuses)
        .where(
          and(
            eq(workflowStatuses.workflowId, workflow.id),
            sql`lower(${workflowStatuses.name}) = lower(${name})`,
            sql`${workflowStatuses.id} <> ${statusId}`,
          ),
        )
        .limit(1);

      if (duplicate.length > 0) {
        throw new ConflictException('A status with this name already exists.');
      }
    }

    // Reorder — load all statuses for the workflow, splice, write back
    let updatedRow = target;
    await this.db.transaction(async (tx) => {
      if (position !== undefined && position !== target.position) {
        const all = await tx
          .select({
            id: workflowStatuses.id,
            position: workflowStatuses.position,
          })
          .from(workflowStatuses)
          .where(eq(workflowStatuses.workflowId, workflow.id))
          .orderBy(workflowStatuses.position);

        const max = all.length;
        if (position < 1 || position > max) {
          throw new BadRequestException(`position must be between 1 and ${max}`);
        }

        // Reorder in JS, then write back dense 1..N
        const fromIdx = all.findIndex((s) => s.id === statusId);
        if (fromIdx === -1) {
          throw new NotFoundException('Status not found in this project workflow');
        }
        const [moved] = all.splice(fromIdx, 1);
        all.splice(position - 1, 0, moved);

        for (let i = 0; i < all.length; i++) {
          const newPos = i + 1;
          if (all[i].position !== newPos) {
            await tx
              .update(workflowStatuses)
              .set({ position: newPos })
              .where(eq(workflowStatuses.id, all[i].id));
          }
        }
      }

      if (name !== undefined && name !== target.name) {
        await tx
          .update(workflowStatuses)
          .set({ name })
          .where(eq(workflowStatuses.id, statusId));
      }

      // Read fresh row to return
      const [refreshed] = await tx
        .select({
          id: workflowStatuses.id,
          name: workflowStatuses.name,
          position: workflowStatuses.position,
        })
        .from(workflowStatuses)
        .where(eq(workflowStatuses.id, statusId))
        .limit(1);

      if (refreshed) updatedRow = refreshed;
    });

    const action =
      name !== undefined && position !== undefined
        ? 'renamedAndReordered'
        : name !== undefined
        ? 'renamed'
        : 'reordered';

    this.logger.log(
      `[AUDIT] workflowStatus.${action} | userId=${userId} | projectKey=${project.key} | statusId=${statusId} | name=${updatedRow.name} | position=${updatedRow.position}`,
    );

    return updatedRow;
  }

  // -------------- delete --------------

  async deleteStatus(projectKey: string, userId: string, statusId: string) {
    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    const [target] = await this.db
      .select({
        id: workflowStatuses.id,
        name: workflowStatuses.name,
        position: workflowStatuses.position,
      })
      .from(workflowStatuses)
      .where(
        and(eq(workflowStatuses.id, statusId), eq(workflowStatuses.workflowId, workflow.id)),
      )
      .limit(1);

    if (!target) {
      throw new NotFoundException('Status not found in this project workflow');
    }

    // Lock the workflow row + recheck guards INSIDE the transaction so a
    // concurrent issue-creation between count-check and DELETE cannot leak.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from workflows where id = ${workflow.id} for update`);

      // Last status guard
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowStatuses)
        .where(eq(workflowStatuses.workflowId, workflow.id));

      if ((countRow?.count ?? 0) <= 1) {
        throw new BadRequestException('A workflow must have at least one status.');
      }

      // Issue count (inside the transaction so no race window remains)
      const [issueCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(issues)
        .where(and(eq(issues.statusId, statusId), isNull(issues.deletedAt)));

      const issueCount = issueCountRow?.count ?? 0;
      if (issueCount > 0) {
        throw new ConflictException(
          `Status has ${issueCount} issue(s). Move them to another status first.`,
        );
      }

      await tx.delete(workflowStatuses).where(eq(workflowStatuses.id, statusId));
      // Re-number survivors to dense 1..N
      await tx
        .update(workflowStatuses)
        .set({ position: sql`${workflowStatuses.position} - 1` })
        .where(
          and(
            eq(workflowStatuses.workflowId, workflow.id),
            sql`${workflowStatuses.position} > ${target.position}`,
          ),
        );
    });

    this.logger.log(
      `[AUDIT] workflowStatus.deleted | userId=${userId} | projectKey=${project.key} | statusId=${statusId} | name=${target.name}`,
    );

    return { id: statusId, deleted: true };
  }

  // -------------- bulk move issues --------------

  async bulkMoveIssues(
    projectKey: string,
    userId: string,
    fromStatusId: string,
    dto: MoveIssuesDto,
  ) {
    const validation = moveIssuesSchema.safeParse(dto);
    if (!validation.success) {
      throw new BadRequestException(
        validation.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { targetStatusId } = validation.data;

    if (fromStatusId === targetStatusId) {
      throw new BadRequestException('targetStatusId must differ from the source status');
    }

    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    // Both statuses must belong to the same project's workflow
    const found = await this.db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.workflowId, workflow.id),
          sql`${workflowStatuses.id} in (${fromStatusId}, ${targetStatusId})`,
        ),
      );

    if (found.length !== 2) {
      throw new BadRequestException(
        'Both source and target statuses must belong to this project workflow',
      );
    }

    let movedCount = 0;
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(issues)
        .set({
          statusId: targetStatusId,
          issueVersion: sql`${issues.issueVersion} + 1`,
          updatedAt: new Date(),
          statusChangedAt: new Date(),
        })
        .where(and(eq(issues.statusId, fromStatusId), isNull(issues.deletedAt)))
        .returning({ id: issues.id });
      movedCount = updated.length;
    });

    this.logger.log(
      `[AUDIT] issue.statusBulkMove | userId=${userId} | projectKey=${project.key} | fromStatusId=${fromStatusId} | toStatusId=${targetStatusId} | count=${movedCount}`,
    );

    return { moved: movedCount };
  }

  // -------------- rules: add --------------

  async addRule(projectKey: string, userId: string, dto: AddRuleDto) {
    const validation = addRuleSchema.safeParse(dto);
    if (!validation.success) {
      throw new BadRequestException(
        validation.error.issues.map((i) => i.message).join(', '),
      );
    }
    const parsed = validation.data;
    const { fromStatusId, toStatusId, ruleType } = parsed;
    const requiredField =
      parsed.ruleType === 'require_field' ? parsed.requiredField : null;

    // Defense in depth: Zod already rejects null/unknown requiredField at the
    // discriminated union layer, but reconfirm at the service boundary so a
    // direct service call (e.g., internal caller, test) cannot bypass it.
    if (ruleType === 'require_field' && !requiredField) {
      throw new BadRequestException(
        'requiredField is required when ruleType is require_field',
      );
    }

    if (fromStatusId !== null && fromStatusId === toStatusId) {
      throw new BadRequestException(
        'fromStatusId and toStatusId must differ (self-transition rules are not allowed)',
      );
    }

    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    // Both referenced statuses must belong to this project's workflow
    const idsToCheck =
      fromStatusId !== null ? [fromStatusId, toStatusId] : [toStatusId];
    const found = await this.db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.workflowId, workflow.id),
          inArray(workflowStatuses.id, idsToCheck),
        ),
      );

    if (found.length !== idsToCheck.length) {
      throw new BadRequestException(
        'Referenced status does not belong to this project workflow',
      );
    }

    let created;
    try {
      const [row] = await this.db
        .insert(workflowRules)
        .values({
          workflowId: workflow.id,
          fromStatusId,
          toStatusId,
          ruleType,
          requiredField,
        })
        .returning({
          id: workflowRules.id,
          fromStatusId: workflowRules.fromStatusId,
          toStatusId: workflowRules.toStatusId,
          ruleType: workflowRules.ruleType,
          requiredField: workflowRules.requiredField,
          createdAt: workflowRules.createdAt,
        });
      created = row;
    } catch (e) {
      // Unique violation from NULLS NOT DISTINCT unique index
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('This rule already exists.');
      }
      throw e;
    }

    this.logger.log(
      `[AUDIT] workflowRule.added | userId=${userId} | projectKey=${project.key} | ruleId=${created.id} | ruleType=${created.ruleType} | requiredField=${created.requiredField ?? 'null'} | fromStatusId=${created.fromStatusId ?? 'null'} | toStatusId=${created.toStatusId}`,
    );

    return created;
  }

  // -------------- rules: list --------------

  async listRules(projectKey: string, userId: string) {
    const { workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    const rows = await this.db
      .select({
        id: workflowRules.id,
        fromStatusId: workflowRules.fromStatusId,
        toStatusId: workflowRules.toStatusId,
        ruleType: workflowRules.ruleType,
        requiredField: workflowRules.requiredField,
        createdAt: workflowRules.createdAt,
      })
      .from(workflowRules)
      .where(eq(workflowRules.workflowId, workflow.id))
      .orderBy(workflowRules.createdAt);

    return rows;
  }

  // -------------- rules: delete --------------

  async deleteRule(projectKey: string, userId: string, ruleId: string) {
    const { project, workflow } = await this.assertOwnerAndLoadContext(projectKey, userId);

    const [target] = await this.db
      .select({ id: workflowRules.id })
      .from(workflowRules)
      .where(
        and(eq(workflowRules.id, ruleId), eq(workflowRules.workflowId, workflow.id)),
      )
      .limit(1);

    if (!target) {
      throw new NotFoundException('Rule not found in this project workflow');
    }

    const deleted = await this.db
      .delete(workflowRules)
      .where(eq(workflowRules.id, ruleId))
      .returning({ id: workflowRules.id });

    if (deleted.length === 0) {
      // Rule vanished concurrently (e.g., via ON DELETE CASCADE from a status
      // delete). Treat as a successful no-op but don't write a misleading audit line.
      return { id: ruleId, deleted: true };
    }

    this.logger.log(
      `[AUDIT] workflowRule.deleted | userId=${userId} | projectKey=${project.key} | ruleId=${ruleId}`,
    );

    return { id: ruleId, deleted: true };
  }
}
