import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RBAC_MATRIX, type PermissionAction } from './rbac.matrix';
import type { ProjectRole } from '@mega-jira/shared';

describe('RbacService', () => {
  let service: RbacService;
  let mockDb: any;

  const project = { id: 'p1', key: 'MEGA', ownerId: 'owner-1' };

  /** Two-call select chain: first project lookup, then membership lookup. */
  function setupDb(p: typeof project | null, membership: { role: string } | null) {
    let call = 0;
    mockDb.select = jest.fn().mockImplementation(() => {
      call++;
      const data =
        call === 1 ? (p ? [p] : []) : membership ? [membership] : [];
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(data),
          }),
        }),
      };
    });
  }

  beforeEach(() => {
    mockDb = { select: jest.fn() };
    service = new RbacService(mockDb);
  });

  describe('loadContext', () => {
    it('404 when project does not exist', async () => {
      setupDb(null, null);
      await expect(service.loadContext('NOPE', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('returns role from project_members for a member', async () => {
      setupDb(project, { role: 'developer' });
      const ctx = await service.loadContext('MEGA', 'u2');
      expect(ctx.role).toBe('developer');
      expect(ctx.project.id).toBe('p1');
    });

    it('owner fallthrough: legacy owner without member row → project_admin', async () => {
      setupDb(project, null);
      const ctx = await service.loadContext('MEGA', 'owner-1');
      expect(ctx.role).toBe('project_admin');
    });

    it('403 when caller is neither member nor owner', async () => {
      setupDb(project, null);
      await expect(service.loadContext('MEGA', 'intruder')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertAction — full matrix table-drive', () => {
    const roles: ProjectRole[] = [
      'system_admin',
      'project_admin',
      'pm',
      'developer',
      'qa',
      'viewer',
    ];

    for (const action of Object.keys(RBAC_MATRIX) as PermissionAction[]) {
      const allowedRoles = RBAC_MATRIX[action] as readonly ProjectRole[];
      for (const role of roles) {
        const expectAllow = allowedRoles.includes(role);
        it(`${action} as ${role} → ${expectAllow ? 'ALLOW' : 'DENY'}`, async () => {
          setupDb(project, { role });
          if (expectAllow) {
            await expect(
              service.assertAction('MEGA', 'u2', action),
            ).resolves.toMatchObject({ role });
          } else {
            await expect(
              service.assertAction('MEGA', 'u2', action),
            ).rejects.toThrow(ForbiddenException);
          }
        });
      }
    }
  });

  describe('mid-action revocation', () => {
    it('next call after role removal fails 403 (no caching)', async () => {
      // First call: developer member → allowed for issue.create
      setupDb(project, { role: 'developer' });
      await expect(
        service.assertAction('MEGA', 'u2', 'issue.create'),
      ).resolves.toMatchObject({ role: 'developer' });

      // Simulate the role being revoked between requests — re-stub DB
      setupDb(project, null);
      await expect(
        service.assertAction('MEGA', 'u2', 'issue.create'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('error payload shape', () => {
    it('matrix denial includes action field', async () => {
      setupDb(project, { role: 'viewer' });
      try {
        await service.assertAction('MEGA', 'u2', 'issue.create');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        const response = e.getResponse();
        expect(response.action).toBe('issue.create');
        expect(response.code).toBe(403);
      }
    });
  });
});
