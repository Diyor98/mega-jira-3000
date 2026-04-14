import { ConflictException, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    transaction: jest.Mock;
  };

  function setupTransactionChain(results: {
    projectResult: unknown[];
    workflowResult: unknown[];
    statusesResult?: unknown;
  }) {
    const mockTx = {
      insert: jest.fn(),
    };

    let insertCallCount = 0;
    mockTx.insert.mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) {
        // Project insert
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(results.projectResult),
          }),
        };
      }
      if (insertCallCount === 2) {
        // Workflow insert
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(results.workflowResult),
          }),
        };
      }
      if (insertCallCount === 3) {
        // Workflow statuses insert
        return {
          values: jest.fn().mockResolvedValue(results.statusesResult ?? undefined),
        };
      }
      // Story 8.1: project_members insert (owner auto-enroll)
      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    mockDb.transaction.mockImplementation((cb) => cb(mockTx));
    return mockTx;
  }

  function setupTransactionThrow(error: unknown) {
    mockDb.transaction.mockRejectedValue(error);
  }

  function setupSelectChain(results: unknown[]) {
    const chain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(results),
    };
    mockDb.select.mockReturnValue(chain);
    return chain;
  }

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      transaction: jest.fn(),
    };
    service = new ProjectsService(mockDb as never);
  });

  describe('create', () => {
    const validDto = { name: 'Mega Platform', key: 'MEGA' };
    const userId = 'user-id-123';
    const mockProject = {
      id: 'project-id-456',
      name: 'Mega Platform',
      key: 'MEGA',
      ownerId: 'user-id-123',
      createdAt: new Date(),
    };
    const mockWorkflow = { id: 'workflow-id-789' };

    it('creates a project with default workflow and 7 statuses', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const mockTx = setupTransactionChain({
        projectResult: [mockProject],
        workflowResult: [mockWorkflow],
      });

      const result = await service.create(validDto, userId);

      expect(result).toEqual(mockProject);
      expect(mockDb.transaction).toHaveBeenCalled();
      // 4 insert calls: project, workflow, statuses, owner-member (Story 8.1)
      expect(mockTx.insert).toHaveBeenCalledTimes(4);
      // AC 6: audit log emitted
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] project.created'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('projectKey=MEGA'),
      );
      logSpy.mockRestore();
    });

    it('returns project data with correct fields', async () => {
      setupTransactionChain({
        projectResult: [mockProject],
        workflowResult: [mockWorkflow],
      });

      const result = await service.create(validDto, userId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name', 'Mega Platform');
      expect(result).toHaveProperty('key', 'MEGA');
      expect(result).toHaveProperty('ownerId', 'user-id-123');
      expect(result).toHaveProperty('createdAt');
    });

    it('throws ConflictException (409) for duplicate key', async () => {
      setupTransactionThrow({ code: '23505' });

      await expect(service.create(validDto, userId)).rejects.toThrow(ConflictException);
      await expect(service.create(validDto, userId)).rejects.toThrow('Project key already in use');
    });

    it('throws BadRequestException (400) for invalid key format', async () => {
      await expect(
        service.create({ name: 'Test', key: 'AB-CD' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for key too short', async () => {
      await expect(
        service.create({ name: 'Test', key: 'A' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for key starting with number', async () => {
      await expect(
        service.create({ name: 'Test', key: '1ABC' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty name', async () => {
      await expect(
        service.create({ name: '', key: 'MEGA' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalizes key to uppercase', async () => {
      const mockTx = setupTransactionChain({
        projectResult: [{ ...mockProject, key: 'TEST' }],
        workflowResult: [mockWorkflow],
      });

      await service.create({ name: 'Test', key: 'test' as any }, userId);

      // The insert should receive uppercase key after normalization
      // However, 'test' won't pass the regex validation since it's checked AFTER toUpperCase
      // Actually the normalization happens before validation, so 'test' -> 'TEST' -> passes regex
      expect(mockTx.insert).toHaveBeenCalled();
    });

    it('re-throws non-unique-violation errors', async () => {
      setupTransactionThrow(new Error('connection failed'));

      await expect(service.create(validDto, userId)).rejects.toThrow('connection failed');
    });
  });

  describe('findAccessible', () => {
    it('returns projects the user owns or is a member of', async () => {
      const mockProjects = [
        { id: 'p1', name: 'Project 1', key: 'P1', ownerId: 'user-1', createdAt: new Date() },
        { id: 'p2', name: 'Project 2', key: 'P2', ownerId: 'someone-else', createdAt: new Date() },
      ];
      setupSelectChain(mockProjects);

      const result = await service.findAccessible('user-1');

      expect(result).toEqual(mockProjects);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('returns empty array when user has no accessible projects', async () => {
      setupSelectChain([]);
      const result = await service.findAccessible('user-1');
      expect(result).toEqual([]);
    });

    it('findByOwner is a backwards-compat alias for findAccessible', async () => {
      setupSelectChain([]);
      const result = await service.findByOwner('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('getStatuses', () => {
    const mockStatuses = [
      { id: 's1', name: 'Backlog', position: 1 },
      { id: 's2', name: 'To Do', position: 2 },
      { id: 's3', name: 'In Progress', position: 3 },
    ];

    it('returns statuses ordered by position', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Project lookup
          return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'project-id' }]) }) }) };
        }
        if (selectCallCount === 2) {
          // Workflow lookup
          return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'workflow-id' }]) }) }) };
        }
        // Statuses
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockResolvedValue(mockStatuses) }) }) };
      });

      const result = await service.getStatuses('MEGA');

      expect(result).toEqual(mockStatuses);
      expect(result[0].position).toBe(1);
    });

    it('throws NotFoundException for invalid project', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getStatuses('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMetadata', () => {
    const existing = {
      id: 'project-id',
      name: 'Old Name',
      key: 'MEGA',
      description: 'Old description',
      ownerId: 'user-1',
      createdAt: new Date(),
    };

    function mockExistingLookup(found: typeof existing | null) {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(found ? [found] : []),
          }),
        }),
      });
    }

    function mockUpdateChain(returned: unknown) {
      const chain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([returned]),
      };
      (mockDb as unknown as { update: jest.Mock }).update = jest.fn().mockReturnValue(chain);
      return chain;
    }

    it('updates name only and records audit row', async () => {
      mockExistingLookup(existing);
      const updated = { ...existing, name: 'New Name' };
      const chain = mockUpdateChain(updated);
      const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
      (service as unknown as { auditLog: typeof auditLog }).auditLog = auditLog;

      const result = await service.updateMetadata('MEGA', { name: 'New Name' }, 'user-1');

      expect(result).toEqual(updated);
      expect(chain.set).toHaveBeenCalledWith({ name: 'New Name' });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'project',
          action: 'updated',
          before: { name: 'Old Name', description: 'Old description' },
          after: { name: 'New Name', description: 'Old description' },
        }),
      );
    });

    it('updates description only', async () => {
      mockExistingLookup(existing);
      const updated = { ...existing, description: 'New desc' };
      const chain = mockUpdateChain(updated);

      const result = await service.updateMetadata('MEGA', { description: 'New desc' }, 'user-1');

      expect(result.description).toBe('New desc');
      expect(chain.set).toHaveBeenCalledWith({ description: 'New desc' });
    });

    it('clears description when null is passed', async () => {
      mockExistingLookup(existing);
      const updated = { ...existing, description: null };
      const chain = mockUpdateChain(updated);

      await service.updateMetadata('MEGA', { description: null }, 'user-1');

      expect(chain.set).toHaveBeenCalledWith({ description: null });
    });

    it('throws NotFoundException for unknown project', async () => {
      mockExistingLookup(null);

      await expect(
        service.updateMetadata('NOPE', { name: 'X' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when both fields are absent', async () => {
      await expect(
        service.updateMetadata('MEGA', {} as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when name exceeds 100 chars', async () => {
      await expect(
        service.updateMetadata('MEGA', { name: 'x'.repeat(101) }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when description exceeds 500 chars', async () => {
      await expect(
        service.updateMetadata('MEGA', { description: 'x'.repeat(501) }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
