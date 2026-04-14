import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database/database.module';
import type { Database } from '../../database/db';
import { projects } from '../../database/schema/projects';
import { projectMembers } from '../../database/schema/project-members';
import type { ProjectRole } from '@mega-jira/shared';
import { RBAC_MATRIX, type PermissionAction } from './rbac.matrix';

export interface RbacContext {
  project: { id: string; key: string; ownerId: string };
  role: ProjectRole;
}

@Injectable()
export class RbacService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Load the caller's permission context for a project. Re-queries the DB
   * on every call — NEVER cache. Mid-action revocation (Story 8.2 AC #8)
   * requires the next request after a role change to fail; caching breaks
   * that guarantee.
   *
   * Owner fallthrough: if the caller is the legacy `projects.owner_id` but
   * has no `project_members` row (Story 8.1's backfill should make this
   * impossible, but the safety net guards against backfill bugs), return
   * `role: 'project_admin'`. Remove once the invariant is verified.
   */
  async loadContext(projectKey: string, userId: string): Promise<RbacContext> {
    const [project] = await this.db
      .select({
        id: projects.id,
        key: projects.key,
        ownerId: projects.ownerId,
      })
      .from(projects)
      .where(eq(projects.key, projectKey))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project '${projectKey}' not found`);
    }

    const [membership] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, userId),
        ),
      )
      .limit(1);

    if (membership) {
      return { project, role: membership.role as ProjectRole };
    }

    if (project.ownerId === userId) {
      return { project, role: 'project_admin' };
    }

    throw new ForbiddenException('You do not have access to this project');
  }

  /**
   * Load context AND assert the caller's role is allowed to perform
   * `action` per the RBAC matrix. Returns the loaded context so callers
   * can avoid a second project lookup.
   */
  async assertAction(
    projectKey: string,
    userId: string,
    action: PermissionAction,
  ): Promise<RbacContext> {
    const ctx = await this.loadContext(projectKey, userId);
    const allowed = RBAC_MATRIX[action] as readonly ProjectRole[];
    if (!allowed.includes(ctx.role)) {
      throw new ForbiddenException({
        error: 'Forbidden',
        message: `You do not have permission to perform this action`,
        code: 403,
        action,
      });
    }
    return ctx;
  }
}
