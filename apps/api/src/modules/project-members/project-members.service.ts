import {
  Injectable,
  Inject,
  Logger,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { users } from '../../database/schema/users';
import { projectMembers } from '../../database/schema/project-members';
import { AuditLogService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { PermissionAction } from '../rbac/rbac.matrix';
import type { ProjectRole } from '@mega-jira/shared';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  /**
   * Story 8.2: gate goes through RbacService. The old private
   * `assertProjectAccess` / `assertCanManageMembers` helpers were deleted —
   * RbacService is the single enforcement surface.
   */
  private async loadProject(
    projectKey: string,
    userId: string,
    action: PermissionAction,
  ) {
    if (this.rbac) {
      await this.rbac.assertAction(projectKey, userId, action);
    }
    const [project] = await this.db
      .select({ id: projects.id, key: projects.key, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);
    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }
    return { project };
  }

  async listByProject(projectKey: string, callerId: string) {
    const { project } = await this.loadProject(projectKey, callerId, 'project.read');

    return this.db
      .select({
        userId: projectMembers.userId,
        email: sql<string>`coalesce(${users.email}, '[deleted user]')`,
        role: projectMembers.role,
        addedAt: projectMembers.addedAt,
        addedBy: projectMembers.addedBy,
      })
      .from(projectMembers)
      .leftJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, project.id))
      .orderBy(projectMembers.addedAt);
  }

  async addMember(
    projectKey: string,
    callerId: string,
    dto: { email: string; role: ProjectRole },
  ) {
    const { project } = await this.loadProject(projectKey, callerId, 'member.manage');

    const [target] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (!target) {
      throw new NotFoundException(`No user with email '${dto.email}'`);
    }

    let inserted;
    try {
      const [row] = await this.db
        .insert(projectMembers)
        .values({
          projectId: project.id,
          userId: target.id,
          role: dto.role,
          addedBy: callerId,
        })
        .returning({
          userId: projectMembers.userId,
          role: projectMembers.role,
          addedAt: projectMembers.addedAt,
          addedBy: projectMembers.addedBy,
        });
      inserted = row;
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err.code === PG_UNIQUE_VIOLATION || err.cause?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`'${dto.email}' is already a member of this project`);
      }
      throw e;
    }

    this.logger.log(
      `[AUDIT] projectMember.added | userId=${callerId} | projectKey=${project.key} | targetUserId=${target.id} | role=${dto.role}`,
    );

    await this.auditLog?.record({
      projectId: project.id,
      actorId: callerId,
      entityType: 'project_member',
      entityId: target.id,
      action: 'created',
      after: { userId: target.id, email: target.email, role: dto.role },
    });

    return { ...inserted, email: target.email };
  }

  async updateRole(
    projectKey: string,
    callerId: string,
    targetUserId: string,
    newRole: ProjectRole,
  ) {
    const { project } = await this.loadProject(projectKey, callerId, 'member.manage');

    if (project.ownerId === targetUserId) {
      throw new BadRequestException('Cannot change the role of the project owner');
    }

    const [existing] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Member not found');
    }

    const [updated] = await this.db
      .update(projectMembers)
      .set({ role: newRole, updatedAt: new Date() })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId),
        ),
      )
      .returning({
        userId: projectMembers.userId,
        role: projectMembers.role,
        addedAt: projectMembers.addedAt,
      });

    this.logger.log(
      `[AUDIT] projectMember.updated | userId=${callerId} | projectKey=${project.key} | targetUserId=${targetUserId} | previousRole=${existing.role} | newRole=${newRole}`,
    );

    await this.auditLog?.record({
      projectId: project.id,
      actorId: callerId,
      entityType: 'project_member',
      entityId: targetUserId,
      action: 'updated',
      before: { role: existing.role },
      after: { role: newRole },
    });

    return updated;
  }

  async removeMember(projectKey: string, callerId: string, targetUserId: string) {
    const { project } = await this.loadProject(projectKey, callerId, 'member.manage');

    if (project.ownerId === targetUserId) {
      throw new BadRequestException('Cannot remove the project owner');
    }

    const [existing] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Member not found');
    }

    await this.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId),
        ),
      );

    this.logger.log(
      `[AUDIT] projectMember.removed | userId=${callerId} | projectKey=${project.key} | targetUserId=${targetUserId} | previousRole=${existing.role}`,
    );

    await this.auditLog?.record({
      projectId: project.id,
      actorId: callerId,
      entityType: 'project_member',
      entityId: targetUserId,
      action: 'deleted',
      before: { role: existing.role },
    });

    return { removed: true, userId: targetUserId };
  }
}
