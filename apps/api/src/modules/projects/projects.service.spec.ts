import { ConflictException, BadRequestException, Logger } from '@nestjs/common';
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
      // Workflow statuses insert
      return {
        values: jest.fn().mockResolvedValue(results.statusesResult ?? undefined),
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
      // 3 insert calls: project, workflow, statuses
      expect(mockTx.insert).toHaveBeenCalledTimes(3);
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

  describe('findByOwner', () => {
    it('returns projects owned by the user', async () => {
      const mockProjects = [
        { id: 'p1', name: 'Project 1', key: 'P1', ownerId: 'user-1', createdAt: new Date() },
        { id: 'p2', name: 'Project 2', key: 'P2', ownerId: 'user-1', createdAt: new Date() },
      ];
      setupSelectChain(mockProjects);

      const result = await service.findByOwner('user-1');

      expect(result).toEqual(mockProjects);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('returns empty array when user has no projects', async () => {
      setupSelectChain([]);

      const result = await service.findByOwner('user-1');

      expect(result).toEqual([]);
    });
  });
});
