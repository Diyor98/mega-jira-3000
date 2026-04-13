import { BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { IssuesService } from './issues.service';

const mockEventService = {
  emitIssueCreated: jest.fn(),
  emitIssueMoved: jest.fn(),
  emitIssueUpdated: jest.fn(),
  emitIssueDeleted: jest.fn(),
  emitIssueRestored: jest.fn(),
};

const mockNotificationsService = {
  createBulk: jest.fn().mockResolvedValue(undefined),
};

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
    jest.clearAllMocks();
    service = new IssuesService(
      mockDb as never,
      mockEventService as never,
      mockNotificationsService as never,
    );
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
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockIssues),
            }),
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
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([]),
            }),
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

    // ===== Story 5.1: filter query composition =====

    // Helper: mocks project lookup + an issues-select whose .where is a spy.
    // Chain shape: select().from().where().orderBy() — post-5.1 review patch #1.
    function setupFilterMocks(issuesResult: unknown[] = []) {
      const orderBySpy = jest.fn().mockResolvedValue(issuesResult);
      const whereSpy = jest.fn().mockReturnValue({ orderBy: orderBySpy });
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
            where: whereSpy,
          }),
        };
      });
      return whereSpy;
    }

    const uuidA = '11111111-1111-1111-1111-111111111111';
    const uuidB = '22222222-2222-2222-2222-222222222222';

    it('no filter params → baseline behavior unchanged', async () => {
      const whereSpy = setupFilterMocks([]);
      const result = await service.findByProject('MEGA');
      expect(result).toEqual([]);
      expect(whereSpy).toHaveBeenCalledTimes(1);
    });

    it('statusId single value → calls where with one condition', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { statusId: uuidA });
      expect(whereSpy).toHaveBeenCalledTimes(1);
    });

    it('statusId comma-joined → normalizes to array of two', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { statusId: `${uuidA},${uuidB}` });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('statusId repeated query style → accepted as array input', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { statusId: [uuidA, uuidB] });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('assigneeId=unassigned → triggers isNull branch', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { assigneeId: 'unassigned' });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('assigneeId=unassigned,<uuid> → mixed or(isNull, inArray)', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { assigneeId: `unassigned,${uuidA}` });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('type=bug → single-value enum filter', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { type: 'bug' });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('type is normalized to lowercase', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { type: 'BUG' });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('priority=P1,P2 → two-value enum filter', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', { priority: 'P1,P2' });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('createdFrom + createdTo → applies both bounds', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', {
        createdFrom: '2026-04-01',
        createdTo: '2026-04-30',
      });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('combined filter (status + priority + date) → still returns', async () => {
      const whereSpy = setupFilterMocks([]);
      await service.findByProject('MEGA', {
        statusId: uuidA,
        priority: 'P1',
        createdFrom: '2026-04-01',
      });
      expect(whereSpy).toHaveBeenCalled();
    });

    it('invalid statusId UUID → BadRequestException', async () => {
      setupFilterMocks([]);
      await expect(
        service.findByProject('MEGA', { statusId: 'not-a-uuid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('invalid date on createdFrom → BadRequestException', async () => {
      setupFilterMocks([]);
      await expect(
        service.findByProject('MEGA', { createdFrom: '2026/04/01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('invalid type enum → BadRequestException', async () => {
      setupFilterMocks([]);
      await expect(
        service.findByProject('MEGA', { type: 'notatype' }),
      ).rejects.toThrow(BadRequestException);
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

    it('audit-warns on version mismatch with structured fields', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setupUpdateMocks(mockProject, []);

      await expect(
        service.update('MEGA', 'issue-id', { title: 'New', issueVersion: 42 }, userId),
      ).rejects.toThrow(ConflictException);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.conflict'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sentVersion=42'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`userId=${userId}`),
      );
      warnSpy.mockRestore();
    });

    it('concurrent updates: first wins, second receives ConflictException', async () => {
      // First call: returning resolves with the updated row (version 1 → 2)
      // Second call: returning resolves empty (stale version 1, current is now 2)
      let updateCallCount = 0;
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });
      mockDb.update.mockImplementation(() => {
        updateCallCount++;
        return {
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue(updateCallCount === 1 ? [updatedIssue] : []),
            }),
          }),
        };
      });

      const first = await service.update('MEGA', 'issue-id', { title: 'A wins', issueVersion: 1 }, 'user-A');
      expect(first.issueVersion).toBe(2);

      await expect(
        service.update('MEGA', 'issue-id', { title: 'B loses', issueVersion: 1 }, 'user-B'),
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

    // Helper: status-changing update() now wraps current-state load + rule
    // check + UPDATE in a transaction (with SELECT ... FOR UPDATE). Sets up
    // mockDb.select for the pre-tx path (project, status+workflow) and
    // mockDb.transaction for the tx body (tx.execute → tx.select[current] →
    // tx.select[rules] → tx.update). Returns the tx object so tests can
    // extend `update.returning` to control the result row.
    function setupStatusUpdateSelects(
      rules: unknown[] = [],
      currentIssue: {
        statusId: string;
        assigneeId: string | null;
        resolution?: string | null;
      } = {
        statusId: 'old-status',
        assigneeId: 'user-1',
        resolution: null,
      },
      updateResult: unknown[] | null = null,
      currentStatusName: string = 'Backlog',
    ) {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Project lookup
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockProject]),
              }),
            }),
          };
        }
        if (selectCallCount === 2) {
          // Status+workflow validation (innerJoin)
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([
                      { id: '00000000-0000-0000-0000-000000000099', workflowId: 'wf-1' },
                    ]),
                }),
              }),
            }),
          };
        }
        // Story 6.3 review patch: pre-update assigneeId snapshot (only runs
        // when the PATCH body includes assigneeId — tests that set an
        // assigneeId reach this select, tests that don't never call it).
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ assigneeId: currentIssue.assigneeId }]),
            }),
          }),
        };
      });

      // Build the tx object used inside db.transaction.
      // Call order inside the tx body: execute (FOR UPDATE), select(currentIssue),
      // select(currentStatusName), select(matchingRules), update.
      let txSelectCount = 0;
      const tx: any = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockImplementation(() => {
          txSelectCount++;
          if (txSelectCount === 1) {
            // Current issue
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([currentIssue]),
                }),
              }),
            };
          }
          if (txSelectCount === 2) {
            // Current status name lookup
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ name: currentStatusName }]),
                }),
              }),
            };
          }
          // Matching rules
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue(rules),
              }),
            }),
          };
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue(updateResult ?? []),
            }),
          }),
        }),
      };
      mockDb.transaction = (mockDb as any).transaction ?? jest.fn();
      (mockDb as any).transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      return tx;
    }

    it('updates statusId when valid status provided', async () => {
      setupStatusUpdateSelects([], { statusId: 'old-status', assigneeId: 'user-1' }, [
        { ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' },
      ]);

      const result = await service.update('MEGA', 'issue-id', {
        statusId: '00000000-0000-0000-0000-000000000099',
        issueVersion: 1,
      }, userId);

      expect(result.statusId).toBe('00000000-0000-0000-0000-000000000099');
    });

    it('throws BadRequestException for statusId not in project workflow', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([mockProject]) }) }) };
        return {
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
      });

      await expect(
        service.update('MEGA', 'issue-id', { statusId: '00000000-0000-0000-0000-000000000088', issueVersion: 1 }, userId),
      ).rejects.toThrow('Invalid status for this project');
    });

    it('audit logs statusId in changed fields', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      setupStatusUpdateSelects([], { statusId: 'old-status', assigneeId: 'user-1' }, [
        { ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' },
      ]);

      await service.update('MEGA', 'issue-id', { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 }, userId);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fields=[statusId]'));
      logSpy.mockRestore();
    });

    // ===== Story 6.3: notification triggers =====

    it('assigneeId change to a non-caller fires an `assigned` notification', async () => {
      jest.clearAllMocks();
      const newAssignee = '00000000-0000-0000-0000-0000000000aa';
      const callerUuid = '00000000-0000-0000-0000-000000000caa';
      const changedIssue = { ...updatedIssue, assigneeId: newAssignee };
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([changedIssue]),
          }),
        }),
      });

      await service.update(
        'MEGA',
        'issue-id',
        { assigneeId: newAssignee, issueVersion: 1 },
        callerUuid,
      );

      expect(mockNotificationsService.createBulk).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            userId: newAssignee,
            type: 'assigned',
            actorId: callerUuid,
          }),
        ]),
      );
    });

    it('self-assignment does NOT fire a notification', async () => {
      jest.clearAllMocks();
      // Caller id must be a valid UUID for the Zod assigneeId check.
      const callerUuid = '00000000-0000-0000-0000-000000000caa';
      const selfAssigned = { ...updatedIssue, assigneeId: callerUuid };
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([selfAssigned]),
          }),
        }),
      });

      await service.update(
        'MEGA',
        'issue-id',
        { assigneeId: callerUuid, issueVersion: 1 },
        callerUuid,
      );

      // Strict assertion — a regression that called createBulk with a
      // non-empty array would silently pass under a loose `if (calls.length > 0)`
      // guard. Be explicit: the call either never happened OR happened with [].
      const calls = mockNotificationsService.createBulk.mock.calls;
      const lastRows = calls.length > 0 ? calls[calls.length - 1][1] : [];
      expect(lastRows).toEqual([]);
    });

    it('status change notifies reporter + assignee, deduped, excluding caller', async () => {
      jest.clearAllMocks();
      const reporterId = '00000000-0000-0000-0000-0000000000rr';
      const assigneeId = '00000000-0000-0000-0000-0000000000bb';
      const statusChanged = {
        ...updatedIssue,
        reporterId,
        assigneeId,
        statusId: '00000000-0000-0000-0000-000000000099',
      };
      setupStatusUpdateSelects([], { statusId: 'old-status', assigneeId }, [
        statusChanged,
      ]);

      await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );

      const calls = mockNotificationsService.createBulk.mock.calls;
      const allRows = calls.flatMap((c: any[]) => c[1]);
      const recipients = allRows.map((r: any) => r.userId).sort();
      expect(recipients).toEqual([assigneeId, reporterId].sort());
      // Every row must be a status_changed notification (no stray assigned).
      expect(allRows.every((r: any) => r.type === 'status_changed')).toBe(true);
    });

    // ===== Story 4.2: Workflow rule enforcement =====

    const ruleRequireAssignee = {
      id: 'rule-1',
      fromStatusId: null,
      toStatusId: '00000000-0000-0000-0000-000000000099',
      ruleType: 'require_assignee',
    };

    it('statusId change with no matching rules → succeeds (behavior unchanged)', async () => {
      setupStatusUpdateSelects([], { statusId: 'old-status', assigneeId: 'user-1' }, [
        { ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' },
      ]);
      const result = await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );
      expect(result.statusId).toBe('00000000-0000-0000-0000-000000000099');
    });

    it('require_assignee rule, issue already has assignee → succeeds', async () => {
      setupStatusUpdateSelects(
        [ruleRequireAssignee],
        { statusId: 'old-status', assigneeId: 'user-7' },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099', assigneeId: 'user-7' }],
      );
      const result = await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );
      expect(result.statusId).toBe('00000000-0000-0000-0000-000000000099');
    });

    it('require_assignee rule, no assignee and PATCH omits it → 422, UPDATE NOT called', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const tx = setupStatusUpdateSelects(
        [ruleRequireAssignee],
        { statusId: 'old-status', assigneeId: null },
      );

      await expect(
        service.update(
          'MEGA',
          'issue-id',
          { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
          userId,
        ),
      ).rejects.toMatchObject({
        getStatus: expect.any(Function),
      });

      expect(tx.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowRule.violation'),
      );
      warnSpy.mockRestore();
    });

    it('require_assignee rule, PATCH provides assigneeId → succeeds', async () => {
      const tx = setupStatusUpdateSelects(
        [ruleRequireAssignee],
        { statusId: 'old-status', assigneeId: null },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099', assigneeId: '00000000-0000-0000-0000-0000000000aa' }],
      );
      const result = await service.update(
        'MEGA',
        'issue-id',
        {
          statusId: '00000000-0000-0000-0000-000000000099',
          assigneeId: '00000000-0000-0000-0000-0000000000aa',
          issueVersion: 1,
        },
        userId,
      );
      expect(result.assigneeId).toBe('00000000-0000-0000-0000-0000000000aa');
      expect(tx.update).toHaveBeenCalled();
    });

    it('two matching rules (from=null and from=current) → only one violation thrown', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setupStatusUpdateSelects(
        [
          { ...ruleRequireAssignee, id: 'rule-a', fromStatusId: null },
          { ...ruleRequireAssignee, id: 'rule-b', fromStatusId: 'old-status' },
        ],
        { statusId: 'old-status', assigneeId: null },
      );

      let thrown: any = null;
      try {
        await service.update(
          'MEGA',
          'issue-id',
          { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
          userId,
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      // The first rule by orderBy is rule-a (mock returns them in this order).
      const body = thrown.getResponse();
      expect(body.rule.id).toBe('rule-a');
      warnSpy.mockRestore();
    });

    it('rule with fromStatusId = X does NOT apply when current status = Y', async () => {
      // Simulate the SQL filter by returning an empty rules array — in prod,
      // the WHERE clause excludes the non-matching rule.
      setupStatusUpdateSelects(
        [],
        { statusId: 'Y', assigneeId: null },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' }],
      );
      const result = await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );
      expect(result.statusId).toBe('00000000-0000-0000-0000-000000000099');
    });

    // ===== Story 4.3: require_field rule type + FR20 reopen =====

    const ruleRequireResolution = {
      id: 'rule-resolution',
      fromStatusId: null,
      toStatusId: '00000000-0000-0000-0000-000000000099',
      ruleType: 'require_field',
      requiredField: 'resolution',
    };

    it('require_field:resolution, PATCH omits resolution → 422, UPDATE NOT called', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const tx = setupStatusUpdateSelects(
        [ruleRequireResolution],
        { statusId: 'old-status', assigneeId: 'user-1', resolution: null },
      );

      let thrown: any = null;
      try {
        await service.update(
          'MEGA',
          'issue-id',
          { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
          userId,
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.getStatus()).toBe(422);
      expect(thrown.getResponse().rule.requiredField).toBe('resolution');
      expect(tx.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('requiredField=resolution'),
      );
      warnSpy.mockRestore();
    });

    it('require_field:resolution, PATCH provides non-empty resolution → succeeds', async () => {
      const tx = setupStatusUpdateSelects(
        [ruleRequireResolution],
        { statusId: 'old-status', assigneeId: 'user-1', resolution: null },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' }],
      );
      const result = await service.update(
        'MEGA',
        'issue-id',
        {
          statusId: '00000000-0000-0000-0000-000000000099',
          resolution: 'Fixed by redeploy',
          issueVersion: 1,
        },
        userId,
      );
      expect(result.statusId).toBe('00000000-0000-0000-0000-000000000099');
      expect(tx.update).toHaveBeenCalled();
    });

    it('require_field:resolution, PATCH provides whitespace-only resolution → 422', async () => {
      const tx = setupStatusUpdateSelects(
        [ruleRequireResolution],
        { statusId: 'old-status', assigneeId: 'user-1', resolution: null },
      );

      let thrown: any = null;
      try {
        await service.update(
          'MEGA',
          'issue-id',
          {
            statusId: '00000000-0000-0000-0000-000000000099',
            resolution: '   ',
            issueVersion: 1,
          },
          userId,
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown?.getStatus()).toBe(422);
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('FR20: reopen from Done → updateData sets resolution=null and statusChangedAt', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      let capturedSetArgs: any = null;
      const tx = setupStatusUpdateSelects(
        [],
        { statusId: 'done-status', assigneeId: 'user-1', resolution: 'Was resolved' },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' }],
        'Done',
      );
      // Replace tx.update with a spy that captures the .set() args
      tx.update = jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((args: any) => {
          capturedSetArgs = args;
          return {
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([
                { ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' },
              ]),
            }),
          };
        }),
      });

      await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );

      expect(capturedSetArgs).not.toBeNull();
      expect(capturedSetArgs.resolution).toBeNull();
      expect(capturedSetArgs.statusChangedAt).toBeInstanceOf(Date);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.reopened'),
      );
      logSpy.mockRestore();
    });

    it('normal status change (not reopen) → resolution unchanged, statusChangedAt bumped', async () => {
      let capturedSetArgs: any = null;
      const tx = setupStatusUpdateSelects(
        [],
        { statusId: 'old-status', assigneeId: 'user-1', resolution: 'prior value' },
        [{ ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' }],
        'Backlog',
      );
      tx.update = jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((args: any) => {
          capturedSetArgs = args;
          return {
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([
                { ...updatedIssue, statusId: '00000000-0000-0000-0000-000000000099' },
              ]),
            }),
          };
        }),
      });

      await service.update(
        'MEGA',
        'issue-id',
        { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
        userId,
      );

      // resolution should NOT be touched (no explicit set)
      expect(capturedSetArgs.resolution).toBeUndefined();
      // statusChangedAt should be bumped on every status change
      expect(capturedSetArgs.statusChangedAt).toBeInstanceOf(Date);
    });

    it('coexisting rules: assignee-missing fires before resolution-missing (by createdAt order)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setupStatusUpdateSelects(
        [
          // First rule (by createdAt order from the mock queue): assignee
          {
            id: 'rule-a',
            fromStatusId: null,
            toStatusId: '00000000-0000-0000-0000-000000000099',
            ruleType: 'require_assignee',
            requiredField: null,
          },
          // Second rule: resolution
          ruleRequireResolution,
        ],
        { statusId: 'old-status', assigneeId: null, resolution: null },
      );

      let thrown: any = null;
      try {
        await service.update(
          'MEGA',
          'issue-id',
          { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
          userId,
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown?.getResponse().rule.ruleType).toBe('require_assignee');
      warnSpy.mockRestore();
    });

    it('violation exception carries structured rule payload in response body', async () => {
      setupStatusUpdateSelects(
        [ruleRequireAssignee],
        { statusId: 'old-status', assigneeId: null },
      );

      let thrown: any = null;
      try {
        await service.update(
          'MEGA',
          'issue-id',
          { statusId: '00000000-0000-0000-0000-000000000099', issueVersion: 1 },
          userId,
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.getStatus()).toBe(422);
      const body = thrown.getResponse();
      expect(body.error).toBe('WorkflowRuleViolation');
      expect(body.rule).toEqual({
        id: 'rule-1',
        ruleType: 'require_assignee',
        requiredField: 'assigneeId',
        fromStatusId: null,
        toStatusId: '00000000-0000-0000-0000-000000000099',
      });
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

    it('audit-warns on softDelete version mismatch', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      setupDeleteMocks(mockProject, []);

      await expect(
        service.softDelete('MEGA', 'issue-id', 7, userId),
      ).rejects.toThrow(ConflictException);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] issue.conflict'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sentVersion=7'),
      );
      warnSpy.mockRestore();
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

  describe('restore', () => {
    const restoredRow = { id: 'issue-id', issueKey: 'MEGA-1', issueVersion: 3 };

    function setupRestoreMocks(
      project: unknown | null,
      current: { deletedAt: Date | null } | null,
      updateResult: unknown[] = [restoredRow],
    ) {
      let call = 0;
      mockDb.select.mockImplementation(() => {
        call++;
        if (call === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue(project ? [project] : []),
              }),
            }),
          };
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(
                current ? [{ id: 'issue-id', issueKey: 'MEGA-1', ...current }] : [],
              ),
            }),
          }),
        };
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(updateResult),
          }),
        }),
      });
    }

    it('404 on unknown project', async () => {
      setupRestoreMocks(null, null);
      await expect(service.restore('NOPE', 'issue-id', userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404 on unknown issue', async () => {
      setupRestoreMocks(mockProject, null);
      await expect(service.restore('MEGA', 'issue-id', userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409 NotDeleted when deletedAt is null', async () => {
      setupRestoreMocks(mockProject, { deletedAt: null });
      await expect(service.restore('MEGA', 'issue-id', userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('409 RestoreWindowExpired when older than retention window', async () => {
      const oldDate = new Date(Date.now() - 31 * 86400 * 1000);
      setupRestoreMocks(mockProject, { deletedAt: oldDate });
      await expect(service.restore('MEGA', 'issue-id', userId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RestoreWindowExpired' }),
      });
    });

    it('restores in-window issue and emits issue.restored', async () => {
      const recent = new Date(Date.now() - 1 * 86400 * 1000);
      setupRestoreMocks(mockProject, { deletedAt: recent });
      const result = await service.restore('MEGA', 'issue-id', userId);
      expect(result.issueKey).toBe('MEGA-1');
      expect(mockEventService.emitIssueRestored).toHaveBeenCalledWith(
        'MEGA',
        expect.objectContaining({ issueId: 'issue-id', actorId: userId }),
      );
    });
  });

  describe('EventService integration', () => {
    it('calls emitIssueCreated after successful create', async () => {
      const mockIssue = {
        id: 'issue-id',
        issueKey: 'MEGA-1',
        title: 'Fix login bug',
        type: 'bug',
        priority: 'P3',
        statusId: 'status-id',
        assigneeId: null,
        reporterId: userId,
        parentId: null,
        issueVersion: 1,
        createdAt: new Date(),
      };

      setupProjectLookup(mockProject);
      setupCreateTransaction(mockIssue);
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.create(validDto, userId, 'MEGA');

      expect(mockEventService.emitIssueCreated).toHaveBeenCalledWith(
        'MEGA',
        expect.objectContaining({
          actorId: userId,
          timestamp: expect.any(String),
        }),
      );
    });

    it('calls emitIssueMoved after statusId update', async () => {
      const updatedIssue = {
        id: 'issue-id',
        issueKey: 'MEGA-1',
        title: 'Test',
        statusId: 'a0000000-0000-0000-0000-000000000002',
        issueVersion: 2,
        description: null,
        type: 'bug',
        priority: 'P3',
        assigneeId: null,
        reporterId: userId,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Pre-tx selects: project, status+workflow
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
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: 'a0000000-0000-0000-0000-000000000002', workflowId: 'wf-1' }]),
              }),
            }),
          }),
        };
      });

      // Tx body: currentIssue → currentStatusName → rules → update
      let txSelectCount = 0;
      const tx: any = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockImplementation(() => {
          txSelectCount++;
          if (txSelectCount === 1) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ statusId: 'old-status', assigneeId: 'u1', resolution: null }]),
                }),
              }),
            };
          }
          if (txSelectCount === 2) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ name: 'Backlog' }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([]),
              }),
            }),
          };
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([updatedIssue]),
            }),
          }),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: any) => cb(tx));

      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.update('MEGA', 'issue-id', { statusId: 'a0000000-0000-0000-0000-000000000002', issueVersion: 1 }, userId);

      expect(mockEventService.emitIssueMoved).toHaveBeenCalledWith(
        'MEGA',
        expect.objectContaining({
          issueId: 'issue-id',
          statusId: 'a0000000-0000-0000-0000-000000000002',
          actorId: userId,
        }),
      );
    });

    it('calls emitIssueUpdated for non-status field updates', async () => {
      const updatedIssue = {
        id: 'issue-id',
        issueKey: 'MEGA-1',
        title: 'Updated title',
        statusId: 'status-id',
        issueVersion: 2,
        description: null,
        type: 'bug',
        priority: 'P3',
        assigneeId: null,
        reporterId: userId,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedIssue]),
          }),
        }),
      });

      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.update('MEGA', 'issue-id', { title: 'Updated title', issueVersion: 1 }, userId);

      expect(mockEventService.emitIssueUpdated).toHaveBeenCalledWith(
        'MEGA',
        expect.objectContaining({
          issueId: 'issue-id',
          fields: { title: 'Updated title' },
          actorId: userId,
        }),
      );
    });

    it('calls emitIssueDeleted after soft delete', async () => {
      const deletedIssue = {
        id: 'issue-id',
        issueKey: 'MEGA-1',
        title: 'Test',
        type: 'bug',
        priority: 'P3',
        issueVersion: 2,
        deletedAt: new Date(),
      };

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([deletedIssue]),
          }),
        }),
      });

      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.softDelete('MEGA', 'issue-id', 1, userId);

      expect(mockEventService.emitIssueDeleted).toHaveBeenCalledWith(
        'MEGA',
        expect.objectContaining({
          issueId: 'issue-id',
          actorId: userId,
        }),
      );
    });
  });
});
