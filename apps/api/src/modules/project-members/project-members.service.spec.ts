import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectMembersService } from './project-members.service';
import { createRbacMock, createRbacDenyMock } from '../../test-utils/rbac-mock';

describe('ProjectMembersService', () => {
  let service: ProjectMembersService;
  let mockDb: any;
  let auditSpy: jest.Mock;

  const ownerProject = { id: 'p1', key: 'MEGA', ownerId: 'owner-1' };

  /** Project select + an optional follow-up select for the second call. */
  function queueSelects(...batches: unknown[][]) {
    let i = 0;
    mockDb.select = jest.fn().mockImplementation(() => {
      const data = batches[i] ?? [];
      i++;
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(data),
          }),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(data),
            }),
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
    service = new ProjectMembersService(
      mockDb,
      { record: auditSpy } as any,
      createRbacMock('project_admin') as any,
    );
  });

  describe('listByProject', () => {
    it('404 on unknown project', async () => {
      queueSelects([]);
      await expect(service.listByProject('NOPE', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('returns rows for an admin caller', async () => {
      queueSelects(
        [ownerProject],
        [{ userId: 'owner-1', email: 'owner@test', role: 'project_admin', addedAt: new Date(), addedBy: 'owner-1' }],
      );
      const rows = await service.listByProject('MEGA', 'owner-1');
      expect(rows).toHaveLength(1);
    });

    it('RBAC: denies when caller has no project access', async () => {
      service = new ProjectMembersService(
        mockDb,
        { record: auditSpy } as any,
        createRbacDenyMock('project.read') as any,
      );
      await expect(service.listByProject('MEGA', 'intruder')).rejects.toThrow(
        ForbiddenException,
      );
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
        const data = call === 1 ? [project] : targetUser ? [targetUser] : [];
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(data),
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

    it('RBAC: denies via assertAction', async () => {
      service = new ProjectMembersService(
        mockDb,
        { record: auditSpy } as any,
        createRbacDenyMock('member.manage') as any,
      );
      await expect(
        service.addMember('MEGA', 'u2', { email: 'alice@test', role: 'pm' }),
      ).rejects.toThrow(ForbiddenException);
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
        const data = call === 1 ? [project] : existing ? [existing] : [];
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(data),
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

    it('RBAC: denies via assertAction', async () => {
      service = new ProjectMembersService(
        mockDb,
        { record: auditSpy } as any,
        createRbacDenyMock('member.manage') as any,
      );
      await expect(
        service.updateRole('MEGA', 'u2', 'u3', 'qa'),
      ).rejects.toThrow(ForbiddenException);
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
        const data = call === 1 ? [project] : existing ? [existing] : [];
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(data),
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

    it('RBAC: denies via assertAction', async () => {
      service = new ProjectMembersService(
        mockDb,
        { record: auditSpy } as any,
        createRbacDenyMock('member.manage') as any,
      );
      await expect(
        service.removeMember('MEGA', 'u2', 'u3'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
