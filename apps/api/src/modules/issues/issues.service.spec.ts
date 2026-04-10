import { BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { IssuesService } from './issues.service';

describe('IssuesService', () => {
  let service: IssuesService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    transaction: jest.Mock;
  };
  // update mock is already in the type above

  const mockProject = { id: 'project-id', key: 'MEGA' };
  const mockWorkflow = { id: 'workflow-id' };
  const mockStatus = { id: 'status-id' };
  const userId = 'user-id-123';
  const validDto = { title: 'Fix login bug', type: 'Bug' as const };

  function setupProjectLookup(project: unknown | null) {
    // Each select call needs its own chain
    let selectCallCount = 0;
    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Project lookup
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(project ? [project] : []),
            }),
          }),
        };
      }
      if (selectCallCount === 2) {
        // Workflow lookup
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockWorkflow]),
            }),
          }),
        };
      }
      if (selectCallCount === 3) {
        // First status lookup
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockStatus]),
              }),
            }),
          }),
        };
      }
      // findByProject — project lookup then issues select
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      };
    });
  }

  function setupCreateTransaction(issueResult: unknown) {
    const mockTx = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ nextSequence: 2 }]),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([issueResult]),
        }),
      }),
    };
    mockDb.transaction.mockImplementation((cb) => cb(mockTx));
    return mockTx;
  }

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      transaction: jest.fn(),
    };
    service = new IssuesService(mockDb as never);
  });

  describe('create', () => {
    const mockIssue = {
      id: 'issue-id',
      issueKey: 'MEGA-1',
      title: 'Fix login bug',
      description: null,
      type: 'bug',
      priority: 'P3',
      statusId: 'status-id',
      assigneeId: null,
      reporterId: 'user-id-123',
      issueVersion: 1,
      createdAt: new Date(),
    };

    it('creates issue with sequential key', async () => {
      setupProjectLookup(mockProject);
      setupCreateTransaction(mockIssue);

      const result = await service.create(validDto, userId, 'MEGA');

      expect(result).toEqual(mockIssue);
      expect(result.issueKey).toBe('MEGA-1');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('defaults priority to P3 when not provided', async () => {
      setupProjectLookup(mockProject);
      const mockTx = setupCreateTransaction(mockIssue);

      await service.create({ title: 'Test', type: 'Story' }, userId, 'MEGA');

      const insertValues = mockTx.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertValues.priority).toBe('P3');
    });

    it('defaults status to first workflow status', async () => {
      setupProjectLookup(mockProject);
      const mockTx = setupCreateTransaction(mockIssue);

      await service.create(validDto, userId, 'MEGA');

      const insertValues = mockTx.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertValues.statusId).toBe('status-id');
    });

    it('throws NotFoundException for invalid project key', async () => {
      setupProjectLookup(null);

      await expect(service.create(validDto, userId, 'INVALID')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for missing title', async () => {
      await expect(
        service.create({ title: '', type: 'Story' }, userId, 'MEGA'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid type', async () => {
      await expect(
        service.create({ title: 'Test', type: 'InvalidType' as any }, userId, 'MEGA'),
      ).rejects.toThrow(BadRequestException);
    });

    it('audit logs issue creation with userId and issueKey', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      setupProjectLookup(mockProject);
      setupCreateTransaction(mockIssue);

      await service.create(validDto, userId, 'MEGA');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.created'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('userId=user-id-123'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('issueKey=MEGA-1'),
      );
      logSpy.mockRestore();
    });

    it('returns correct response shape', async () => {
      setupProjectLookup(mockProject);
      setupCreateTransaction(mockIssue);

      const result = await service.create(validDto, userId, 'MEGA');

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('issueKey');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('priority');
      expect(result).toHaveProperty('statusId');
      expect(result).toHaveProperty('reporterId');
      expect(result).toHaveProperty('issueVersion');
      expect(result).toHaveProperty('createdAt');
    });
  });

  describe('findByProject', () => {
    it('returns issues for project', async () => {
      const mockIssues = [
        { id: '1', issueKey: 'MEGA-1', title: 'Issue 1', type: 'story', priority: 'P3', statusId: 's1', assigneeId: null, reporterId: 'u1', issueVersion: 1, createdAt: new Date(), description: null },
      ];

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockProject]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockIssues),
          }),
        };
      });

      const result = await service.findByProject('MEGA');

      expect(result).toEqual(mockIssues);
    });

    it('returns empty array when no issues', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockProject]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        };
      });

      const result = await service.findByProject('MEGA');

      expect(result).toEqual([]);
    });

    it('throws NotFoundException for invalid project', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findByProject('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    const mockDetailIssue = {
      id: 'issue-id',
      issueKey: 'MEGA-1',
      title: 'Fix bug',
      description: 'Some description',
      type: 'bug',
      priority: 'P1',
      statusId: 'status-id',
      assigneeId: null,
      reporterId: 'user-1',
      issueVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns issue by id', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockProject]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockDetailIssue]),
            }),
          }),
        };
      });

      const result = await service.findById('MEGA', 'issue-id');

      expect(result).toEqual(mockDetailIssue);
      expect(result).toHaveProperty('updatedAt');
    });

    it('throws NotFoundException for missing issue', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockProject]),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        };
      });

      await expect(service.findById('MEGA', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for missing project', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findById('INVALID', 'issue-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updatedIssue = {
      id: 'issue-id',
      issueKey: 'MEGA-1',
      title: 'Updated title',
      description: null,
      type: 'bug',
      priority: 'P2',
      statusId: 'status-id',
      assigneeId: null,
      reporterId: 'user-1',
      issueVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function setupUpdateMocks(project: unknown | null, updateResult: unknown[]) {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(project ? [project] : []),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(updateResult),
          }),
        }),
      });
    }

    it('updates title and increments issueVersion', async () => {
      setupUpdateMocks(mockProject, [updatedIssue]);

      const result = await service.update('MEGA', 'issue-id', {
        title: 'Updated title',
        issueVersion: 1,
      }, userId);

      expect(result.title).toBe('Updated title');
      expect(result.issueVersion).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('throws ConflictException on version mismatch', async () => {
      setupUpdateMocks(mockProject, []);

      await expect(
        service.update('MEGA', 'issue-id', { title: 'New', issueVersion: 99 }, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for non-existent project', async () => {
      setupUpdateMocks(null, []);

      await expect(
        service.update('INVALID', 'issue-id', { title: 'New', issueVersion: 1 }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for missing issueVersion', async () => {
      await expect(
        service.update('MEGA', 'issue-id', { title: 'New' } as any, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('audit logs update with changed field names', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      setupUpdateMocks(mockProject, [updatedIssue]);

      await service.update('MEGA', 'issue-id', {
        title: 'Updated',
        priority: 'P2',
        issueVersion: 1,
      }, userId);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.updated'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('fields=[title,priority]'),
      );
      logSpy.mockRestore();
    });
  });

  describe('create with parentId', () => {
    const validDto = { title: 'Child Story', type: 'Story' as const, parentId: '00000000-0000-0000-0000-000000000001' };
    const mockEpicParent = { id: '00000000-0000-0000-0000-000000000001', type: 'epic', projectId: 'project-id' };

    it('creates child issue when parent is Epic', async () => {
      // Setup: project lookup, workflow, status, then parent lookup, then transaction
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'wf-id' }]) }) }) };
        if (selectCallCount === 3) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'status-id' }]) }) }) }) };
        // Parent lookup
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockEpicParent]) }) }) };
      });

      const mockTx = { update: jest.fn(), insert: jest.fn() };
      mockTx.update.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ nextSequence: 2 }]) }) }) });
      mockTx.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: 'child-id', issueKey: 'MEGA-1', title: 'Child Story', type: 'story', parentId: '00000000-0000-0000-0000-000000000001', issueVersion: 1, createdAt: new Date() }]) }) });
      mockDb.transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.create(validDto, userId, 'MEGA');
      expect(result.parentId).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('throws BadRequestException when parent is not Epic', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'wf-id' }]) }) }) };
        if (selectCallCount === 3) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'status-id' }]) }) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000002', type: 'story', projectId: 'project-id' }]) }) }) };
      });

      await expect(service.create(validDto, userId, 'MEGA')).rejects.toThrow('Only Epics can have child issues');
    });

    it('throws BadRequestException when child type is Epic', async () => {
      const epicChildDto = { title: 'Sub Epic', type: 'Epic' as const, parentId: '00000000-0000-0000-0000-000000000001' };

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'wf-id' }]) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'status-id' }]) }) }) }) };
      });

      await expect(service.create(epicChildDto, userId, 'MEGA')).rejects.toThrow('Epics cannot be child issues');
    });

    it('throws NotFoundException when parent does not exist', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'wf-id' }]) }) }) };
        if (selectCallCount === 3) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'status-id' }]) }) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) };
      });

      await expect(service.create(validDto, userId, 'MEGA')).rejects.toThrow('Parent issue not found');
    });
  });

  describe('findChildren', () => {
    it('returns child issues', async () => {
      const mockChildren = [
        { id: 'c1', issueKey: 'MEGA-2', title: 'Child 1', type: 'story', priority: 'P3', statusId: 's1' },
      ];
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(mockChildren) }) };
      });

      const result = await service.findChildren('MEGA', '00000000-0000-0000-0000-000000000001');
      expect(result).toEqual(mockChildren);
    });
  });

  describe('getProgress', () => {
    it('calculates percentage correctly', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ count: 5 }]) }) };
        // Completed count query with innerJoin
        return {
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([{ count: 3 }]),
            }),
          }),
        };
      });

      const result = await service.getProgress('MEGA', '00000000-0000-0000-0000-000000000001');
      expect(result).toEqual({ total: 5, completed: 3, percentage: 60 });
    });

    it('returns 0% for Epic with no children', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ count: 0 }]) }) };
        return {
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([{ count: 0 }]),
            }),
          }),
        };
      });

      const result = await service.getProgress('MEGA', '00000000-0000-0000-0000-000000000001');
      expect(result).toEqual({ total: 0, completed: 0, percentage: 0 });
    });
  });

  describe('createLink', () => {
    const sourceId = '00000000-0000-0000-0000-000000000010';
    const targetId = '00000000-0000-0000-0000-000000000020';

    function setupLinkMocks(source: unknown | null, target: unknown | null) {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(source ? [source] : []) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(target ? [target] : []) }) }) };
      });
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{
            id: 'link-id', sourceIssueId: sourceId, targetIssueId: targetId, linkType: 'related', createdAt: new Date(),
          }]),
        }),
      });
    }

    it('creates a link between two issues', async () => {
      setupLinkMocks({ id: sourceId, issueKey: 'MEGA-1' }, { id: targetId, issueKey: 'MEGA-2' });

      const result = await service.createLink('MEGA', sourceId, { targetIssueId: targetId, linkType: 'related' }, userId);

      expect(result.linkType).toBe('related');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('throws for self-linking', async () => {
      await expect(
        service.createLink('MEGA', sourceId, { targetIssueId: sourceId, linkType: 'related' }, userId),
      ).rejects.toThrow('Cannot link an issue to itself');
    });

    it('throws for non-existent target', async () => {
      setupLinkMocks({ id: sourceId, issueKey: 'MEGA-1' }, null);

      await expect(
        service.createLink('MEGA', sourceId, { targetIssueId: targetId, linkType: 'related' }, userId),
      ).rejects.toThrow('Target issue not found');
    });
  });

  describe('getLinks', () => {
    it('returns links from both directions', async () => {
      const issueId = '00000000-0000-0000-0000-000000000010';
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        // 1: project lookup
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        // 2: issue belongs to project check
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: issueId }]) }) }) };
        // 3: links query
        if (selectCallCount === 3) return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { id: 'link-1', sourceIssueId: issueId, targetIssueId: '00000000-0000-0000-0000-000000000020', linkType: 'related', createdAt: new Date() },
            ]),
          }),
        };
        // 4: Resolve linked issue
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000020', issueKey: 'MEGA-2', title: 'Other', type: 'story', priority: 'P3', statusId: 's1' }]) }) }) };
      });

      const result = await service.getLinks('MEGA', issueId);

      expect(result).toHaveLength(1);
      expect(result[0].direction).toBe('outgoing');
      expect(result[0].issue.issueKey).toBe('MEGA-2');
    });
  });

  describe('createBugFromStory', () => {
    it('creates Bug and auto-links to Story', async () => {
      // Mock for createBugFromStory: project lookup, story lookup, then create() internals
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        if (selectCallCount === 2) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'story-id', issueKey: 'MEGA-1', type: 'story' }]) }) }) };
        // create() internals: project, workflow, status
        if (selectCallCount === 3) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'project-id', key: 'MEGA' }]) }) }) };
        if (selectCallCount === 4) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'wf-id' }]) }) }) };
        if (selectCallCount === 5) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'status-id' }]) }) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) };
      });

      // Transaction for create()
      const mockTx = { update: jest.fn(), insert: jest.fn() };
      mockTx.update.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ nextSequence: 2 }]) }) }) });
      mockTx.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{
        id: 'bug-id', issueKey: 'MEGA-2', title: 'Bug title', type: 'bug', priority: 'P3',
        statusId: 'status-id', assigneeId: null, reporterId: userId, parentId: null, issueVersion: 1, createdAt: new Date(),
      }]) }) });
      mockDb.transaction.mockImplementation((cb) => cb(mockTx));

      // Insert for auto-link
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.createBugFromStory('MEGA', 'story-id', { title: 'Bug title' }, userId);

      expect(result.type).toBe('bug');
      expect(result.issueKey).toBe('MEGA-2');
    });

    it('throws if source is not a Story', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'epic-id', issueKey: 'MEGA-1', type: 'epic' }]) }) }) };
      });

      await expect(
        service.createBugFromStory('MEGA', 'epic-id', { title: 'Bug' }, userId),
      ).rejects.toThrow('Can only create bugs from Story-type issues');
    });
  });

  describe('softDelete', () => {
    const deletedIssue = {
      id: 'issue-id',
      issueKey: 'MEGA-1',
      title: 'To delete',
      type: 'story',
      priority: 'P3',
      issueVersion: 2,
      deletedAt: new Date(),
    };

    function setupDeleteMocks(project: unknown | null, updateResult: unknown[]) {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(project ? [project] : []),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(updateResult),
          }),
        }),
      });
    }

    it('soft-deletes issue and increments version', async () => {
      setupDeleteMocks(mockProject, [deletedIssue]);

      const result = await service.softDelete('MEGA', 'issue-id', 1, userId);

      expect(result.issueKey).toBe('MEGA-1');
      expect(result.deletedAt).toBeDefined();
      expect(result.issueVersion).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('throws ConflictException on version mismatch', async () => {
      setupDeleteMocks(mockProject, []);

      await expect(
        service.softDelete('MEGA', 'issue-id', 99, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for non-existent project', async () => {
      setupDeleteMocks(null, []);

      await expect(
        service.softDelete('INVALID', 'issue-id', 1, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('audit logs deletion with issueKey', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      setupDeleteMocks(mockProject, [deletedIssue]);

      await service.softDelete('MEGA', 'issue-id', 1, userId);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.deleted'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('issueKey=MEGA-1'),
      );
      logSpy.mockRestore();
    });
  });
});
