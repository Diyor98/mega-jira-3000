import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RBAC_MATRIX, type PermissionAction } from '../modules/rbac/rbac.matrix';
import type { ProjectRole } from '@mega-jira/shared';

interface MockProject {
  id: string;
  key: string;
  ownerId: string;
}

const DEFAULT_PROJECT: MockProject = {
  id: 'proj-1',
  key: 'MJ',
  ownerId: 'owner-1',
};

/**
 * Returns a permissive RbacService mock that grants `assertAction` if the
 * given `role` is allowed for the requested action per RBAC_MATRIX. Use in
 * service unit tests in place of a real RbacService.
 */
export function createRbacMock(
  role: ProjectRole = 'project_admin',
  project: MockProject = DEFAULT_PROJECT,
) {
  return {
    loadContext: jest.fn().mockResolvedValue({ project, role }),
    assertAction: jest
      .fn()
      .mockImplementation((_key: string, _userId: string, action: PermissionAction) => {
        const allowed = RBAC_MATRIX[action] as readonly ProjectRole[];
        if (!allowed.includes(role)) {
          return Promise.reject(
            new ForbiddenException({
              error: 'Forbidden',
              message: 'You do not have permission to perform this action',
              code: 403,
              action,
            }),
          );
        }
        return Promise.resolve({ project, role });
      }),
  };
}

/**
 * Returns an RbacService mock that ALWAYS denies the given action (or all
 * actions if not specified). Use to assert services correctly propagate
 * 403s from the gate.
 */
export function createRbacDenyMock(action?: PermissionAction) {
  return {
    loadContext: jest
      .fn()
      .mockRejectedValue(
        new ForbiddenException('You do not have access to this project'),
      ),
    assertAction: jest
      .fn()
      .mockImplementation((_key: string, _userId: string, requested: PermissionAction) => {
        if (action && requested !== action) {
          // Deny non-matching actions too — the service should propagate any 403.
          return Promise.reject(new ForbiddenException({ action: requested }));
        }
        return Promise.reject(
          new ForbiddenException({
            error: 'Forbidden',
            message: 'You do not have permission to perform this action',
            code: 403,
            action: requested,
          }),
        );
      }),
  };
}

/** RbacService mock that 404s — caller hit an unknown projectKey. */
export function createRbacNotFoundMock() {
  return {
    loadContext: jest
      .fn()
      .mockRejectedValue(new NotFoundException("Project 'NOPE' not found")),
    assertAction: jest
      .fn()
      .mockRejectedValue(new NotFoundException("Project 'NOPE' not found")),
  };
}
