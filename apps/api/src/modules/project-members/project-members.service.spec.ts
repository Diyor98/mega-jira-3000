import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectMembersService } from './project-members.service';

describe('ProjectMembersService', () => {
  let service: ProjectMembersService;
  let mockDb: any;
  let auditSpy: jest.Mock;

  const ownerProject = { id: 'p1', key: 'MEGA', ownerId: 'owner-1' };

  function setupGate(
    project: unknown | null,
    membership: { role: string } | null = null,
  ) {
    let call = 0;
    mockDb.select = jest.fn().mockImplementation(() => {
      call++;
      const data = call === 1 ? (project ? [project] : []) : membership ? [membership] : [];
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
    auditSpy = jest.fn().mockResolvedValue(undefined);
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new ProjectMembersService(mockDb, { record: auditSpy } as any);
  });

  describe('assertCanManageMembers (via listByProject)', () => {
    it('404 on unknown project', async () => {
      setupGate(null);
      await expect(service.listByProject('NOPE', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('allows legacy owner without membership row', async () => {
      setupGate(ownerProject);
      // leftJoin chain for listByProject final query:
      mockDb.select = jest
        .fn()
        // gate call #1: project
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([ownerProject]),
            }),
          }),
        })
        // listByProject result query:
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([
                  { userId: 'owner-1', email: 'owner@test', role: 'project_admin', addedAt: new Date(), addedBy: 'owner-1' },
                ]),
              }),
            }),
          }),
        });
      const rows = await service.listByProject('MEGA', 'owner-1');
      expect(rows).toHaveLength(1);
    });

    it('403 for non-member non-owner', async () => {
      setupGate(ownerProject, null);
      await expect(service.listByProject('MEGA', 'intruder')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows member with role=viewer (read-only access)', async () => {
      // Story 8.1 M1 patch: listByProject uses assertProjectAccess, which
      // allows any member regardless of role. Write methods still gate
      // via assertCanManageMembers.
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([ownerProject]),
              }),
            }),
          };
        }
        if (call === 2) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ role: 'viewer' }]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
      });
      await expect(service.listByProject('MEGA', 'u2')).resolves.toEqual([]);
    });

    it('403 on updateRole when caller is a non-admin member', async () => {
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([ownerProject]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ role: 'developer' }]),
            }),
          }),
        };
      });
      await expect(
        service.updateRole('MEGA', 'u2', 'u3', 'qa'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows system_admin member', async () => {
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([ownerProject]),
              }),
            }),
          };
        }
        if (call === 2) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ role: 'system_admin' }]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
      });
      await expect(service.listByProject('MEGA', 'u2')).resolves.toEqual([]);
    });
  });

  describe('addMember', () => {
    function setupAddMocks(
      project: unknown,
      targetUser: unknown | null,
      insertResult: unknown[],
      opts: { throwUnique?: boolean } = {},
    ) {
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([project]),
              }),
            }),
          };
        }
        // target user lookup (owner passes gate → skips membership call)
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(targetUser ? [targetUser] : []),
            }),
          }),
        };
      });
      mockDb.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: opts.throwUnique
            ? jest.fn().mockRejectedValue({ code: '23505' })
            : jest.fn().mockResolvedValue(insertResult),
        }),
      });
    }

    it('happy path — adds and emits audit', async () => {
      setupAddMocks(
        ownerProject,
        { id: 'u2', email: 'alice@test' },
        [{ userId: 'u2', role: 'developer', addedAt: new Date(), addedBy: 'owner-1' }],
      );
      const result = await service.addMember('MEGA', 'owner-1', {
        email: 'alice@test',
        role: 'developer',
      });
      expect(result.email).toBe('alice@test');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'project_member', action: 'created' }),
      );
    });

    it('404 on unknown email', async () => {
      setupAddMocks(ownerProject, null, []);
      await expect(
        service.addMember('MEGA', 'owner-1', { email: 'ghost@test', role: 'pm' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('409 on duplicate membership', async () => {
      setupAddMocks(
        ownerProject,
        { id: 'u2', email: 'alice@test' },
        [],
        { throwUnique: true },
      );
      await expect(
        service.addMember('MEGA', 'owner-1', { email: 'alice@test', role: 'pm' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    function setupUpdateMocks(
      project: unknown,
      existing: { role: string } | null,
      updated: unknown[] = [{ userId: 'u2', role: 'qa', addedAt: new Date() }],
    ) {
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([project]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(existing ? [existing] : []),
            }),
          }),
        };
      });
      mockDb.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(updated),
          }),
        }),
      });
    }

    it('400 when targeting the owner', async () => {
      setupUpdateMocks(ownerProject, { role: 'project_admin' });
      await expect(
        service.updateRole('MEGA', 'owner-1', 'owner-1', 'viewer'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 when not a member', async () => {
      setupUpdateMocks(ownerProject, null);
      await expect(
        service.updateRole('MEGA', 'owner-1', 'u2', 'qa'),
      ).rejects.toThrow(NotFoundException);
    });

    it('happy path — updates and audits', async () => {
      setupUpdateMocks(ownerProject, { role: 'developer' });
      const result = await service.updateRole('MEGA', 'owner-1', 'u2', 'qa');
      expect(result).toBeDefined();
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'project_member',
          action: 'updated',
          before: { role: 'developer' },
          after: { role: 'qa' },
        }),
      );
    });
  });

  describe('removeMember', () => {
    function setupRemoveMocks(
      project: unknown,
      existing: { role: string } | null,
    ) {
      let call = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([project]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(existing ? [existing] : []),
            }),
          }),
        };
      });
      mockDb.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
    }

    it('400 when targeting the owner', async () => {
      setupRemoveMocks(ownerProject, { role: 'project_admin' });
      await expect(
        service.removeMember('MEGA', 'owner-1', 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 when not a member', async () => {
      setupRemoveMocks(ownerProject, null);
      await expect(
        service.removeMember('MEGA', 'owner-1', 'u2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('happy path — removes and audits', async () => {
      setupRemoveMocks(ownerProject, { role: 'qa' });
      const result = await service.removeMember('MEGA', 'owner-1', 'u2');
      expect(result.removed).toBe(true);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'project_member',
          action: 'deleted',
          before: { role: 'qa' },
        }),
      );
    });
  });
});
