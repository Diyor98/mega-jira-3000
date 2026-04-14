import { ProjectMembersController } from './project-members.controller';
import { RBAC_MATRIX } from '../rbac/rbac.matrix';
import { ForbiddenException } from '@nestjs/common';

function makeReq(userId: string) {
  return { user: { userId } } as never;
}

describe('ProjectMembersController.me', () => {
  const project = { id: 'p1', key: 'MEGA', ownerId: 'owner-1' };

  it('returns role + flat permission map for a developer member', async () => {
    const rbac = {
      loadContext: jest.fn().mockResolvedValue({ project, role: 'developer' }),
      assertAction: jest.fn(),
    };
    const ctrl = new ProjectMembersController(
      { listByProject: jest.fn() } as never,
      rbac as never,
    );
    const result = await ctrl.me('MEGA', makeReq('u2'));
    expect(result.role).toBe('developer');
    expect(result.projectKey).toBe('MEGA');
    expect(result.permissions['issue.create']).toBe(true);
    expect(result.permissions['issue.delete']).toBe(false);
    expect(result.permissions['workflow.edit']).toBe(false);
    // Every key in the matrix is present
    for (const action of Object.keys(RBAC_MATRIX)) {
      expect(action in result.permissions).toBe(true);
    }
  });

  it('returns viewer permissions correctly', async () => {
    const rbac = {
      loadContext: jest.fn().mockResolvedValue({ project, role: 'viewer' }),
      assertAction: jest.fn(),
    };
    const ctrl = new ProjectMembersController(
      { listByProject: jest.fn() } as never,
      rbac as never,
    );
    const result = await ctrl.me('MEGA', makeReq('u2'));
    expect(result.role).toBe('viewer');
    expect(result.permissions['issue.create']).toBe(false);
    expect(result.permissions['issue.transition']).toBe(false);
    expect(result.permissions['project.read']).toBe(true);
    expect(result.permissions['filter.read']).toBe(true);
  });

  it('propagates 403 from rbac.loadContext for a non-member', async () => {
    const rbac = {
      loadContext: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('You do not have access to this project')),
      assertAction: jest.fn(),
    };
    const ctrl = new ProjectMembersController(
      { listByProject: jest.fn() } as never,
      rbac as never,
    );
    await expect(ctrl.me('MEGA', makeReq('intruder'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
