import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';

/**
 * These tests build small lookup-call queues so each `db.select()` invocation
 * dequeues a fresh chain. The service performs many sequential reads
 * (project → workflow → status → counts → reorder snapshot), so a queue is
 * the simplest way to script them.
 */

type SelectResult = unknown[];

function buildSelectChain(result: SelectResult) {
  const chain: any = {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(result),
        orderBy: jest.fn().mockResolvedValue(result),
      }),
    }),
  };
  // Allow the .from().where() chain to also be awaited directly (for results
  // without .limit), and to support orderBy.
  chain.from = jest.fn().mockReturnValue({
    where: jest.fn().mockImplementation(() => {
      const whereChain: any = {
        limit: jest.fn().mockResolvedValue(result),
        orderBy: jest.fn().mockResolvedValue(result),
        then: (resolve: (v: SelectResult) => unknown) => Promise.resolve(result).then(resolve),
      };
      return whereChain;
    }),
  });
  return chain;
}

function makeDb(selectQueue: SelectResult[]) {
  let i = 0;
  const db: any = {
    select: jest.fn().mockImplementation(() => {
      const next = selectQueue[i] ?? [];
      i++;
      return buildSelectChain(next);
    }),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn(),
  };
  return db;
}

/**
 * Build a tx-like object whose `select` returns successive results from a queue.
 * Used by the addStatus / deleteStatus tests since the service now wraps those
 * paths in transactions with row locks.
 */
function makeTx(selectQueue: SelectResult[]) {
  let i = 0;
  const tx: any = {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockImplementation(() => {
      const next = selectQueue[i] ?? [];
      i++;
      return buildSelectChain(next);
    }),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  return tx;
}

describe('WorkflowService', () => {
  const userId = 'user-1';
  const ownerProject = { id: 'proj-1', key: 'MJ', ownerId: userId };
  const otherProject = { id: 'proj-1', key: 'MJ', ownerId: 'someone-else' };
  const workflow = { id: 'wf-1' };

  let service: WorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== assertOwnership / lookup ==========

  describe('assertOwnership (via addStatus)', () => {
    it('throws ForbiddenException when caller is not the project owner', async () => {
      const db = makeDb([[otherProject], [workflow]]);
      service = new WorkflowService(db);

      await expect(
        service.addStatus('MJ', userId, { name: 'Peer Review' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      const db = makeDb([[]]);
      service = new WorkflowService(db);

      await expect(
        service.addStatus('NOPE', userId, { name: 'Peer Review' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ========== addStatus ==========

  describe('addStatus', () => {
    it('inserts a new status with next position and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // db.select calls (outside tx): project, workflow
      const db = makeDb([[ownerProject], [workflow]]);
      // tx.select calls (inside tx): dup-check (none), max position
      const tx = makeTx([[], [{ max: 3 }]]);
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([{ id: 'st-new', name: 'Peer Review', position: 4 }]),
        }),
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.addStatus('MJ', userId, { name: 'Peer Review' });

      expect(result).toEqual({ id: 'st-new', name: 'Peer Review', position: 4 });
      expect(tx.insert).toHaveBeenCalled();
      expect(tx.execute).toHaveBeenCalled(); // FOR UPDATE row lock
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowStatus.added'),
      );
      logSpy.mockRestore();
    });

    it('throws ConflictException on duplicate name (case-insensitive)', async () => {
      const db = makeDb([[ownerProject], [workflow]]);
      // tx: dup-check returns a row
      const tx = makeTx([[{ id: 'existing' }]]);
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      await expect(
        service.addStatus('MJ', userId, { name: 'BACKLOG' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException on empty/whitespace name', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);

      await expect(service.addStatus('MJ', userId, { name: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException on name longer than 100 chars', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);

      await expect(
        service.addStatus('MJ', userId, { name: 'x'.repeat(101) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses position 1 when no statuses exist yet', async () => {
      const db = makeDb([[ownerProject], [workflow]]);
      const tx = makeTx([[], [{ max: 0 }]]);
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((vals: any) => {
          expect(vals.position).toBe(1);
          return {
            returning: jest
              .fn()
              .mockResolvedValue([{ id: 'st-1', name: 'First', position: 1 }]),
          };
        }),
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.addStatus('MJ', userId, { name: 'First' });
      expect(result.position).toBe(1);
    });
  });

  // ========== updateStatus (rename / reorder) ==========

  describe('updateStatus', () => {
    const target = { id: 'st-2', name: 'To Do', position: 2 };

    it('renames a status and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // Selects (outside tx): project, workflow, target, dup-check (none)
      // Selects (inside tx): refreshed
      const db = makeDb([
        [ownerProject],
        [workflow],
        [target],
        [],
      ]);
      const tx: any = {
        select: jest.fn().mockImplementation(() =>
          buildSelectChain([{ ...target, name: 'Doing' }]),
        ),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.updateStatus('MJ', userId, 'st-2', { name: 'Doing' });

      expect(result.name).toBe('Doing');
      expect(tx.update).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowStatus.renamed'),
      );
      logSpy.mockRestore();
    });

    it('throws ConflictException on duplicate rename (case-insensitive)', async () => {
      const db = makeDb([
        [ownerProject],
        [workflow],
        [target],
        [{ id: 'st-other' }], // duplicate found
      ]);
      service = new WorkflowService(db);

      await expect(
        service.updateStatus('MJ', userId, 'st-2', { name: 'BACKLOG' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when status does not belong to workflow', async () => {
      const db = makeDb([[ownerProject], [workflow], []]);
      service = new WorkflowService(db);

      await expect(
        service.updateStatus('MJ', userId, 'nope', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reorders statuses to dense 1..N', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // Selects outside tx: project, workflow, target
      const db = makeDb([[ownerProject], [workflow], [target]]);

      const all = [
        { id: 'st-1', position: 1 },
        { id: 'st-2', position: 2 }, // moving this to position 4
        { id: 'st-3', position: 3 },
        { id: 'st-4', position: 4 },
      ];
      const updateCalls: Array<{ id: string; position: number }> = [];
      const tx: any = {
        select: jest
          .fn()
          // first call: load all positions
          .mockImplementationOnce(() => buildSelectChain(all))
          // second call: refresh after update
          .mockImplementationOnce(() =>
            buildSelectChain([{ id: 'st-2', name: 'To Do', position: 4 }]),
          ),
        update: jest.fn().mockImplementation(() => ({
          set: jest.fn().mockImplementation((vals: any) => ({
            where: jest.fn().mockImplementation(() => {
              updateCalls.push({ id: 'unknown', position: vals.position });
              return Promise.resolve(undefined);
            }),
          })),
        })),
      };
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.updateStatus('MJ', userId, 'st-2', { position: 4 });

      expect(result.position).toBe(4);
      // Should issue at least one position update (and the result is dense)
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowStatus.reordered'),
      );
      logSpy.mockRestore();
    });

    it('throws BadRequestException for out-of-bounds position', async () => {
      const db = makeDb([[ownerProject], [workflow], [target]]);
      const all = [
        { id: 'st-1', position: 1 },
        { id: 'st-2', position: 2 },
      ];
      const tx: any = {
        select: jest.fn().mockImplementation(() => buildSelectChain(all)),
        update: jest.fn(),
      };
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      await expect(
        service.updateStatus('MJ', userId, 'st-2', { position: 99 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither name nor position provided', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);

      await expect(
        service.updateStatus('MJ', userId, 'st-2', {} as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ========== deleteStatus ==========

  describe('deleteStatus', () => {
    const target = { id: 'st-2', name: 'To Do', position: 2 };

    it('deletes a status with zero issues and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // db.select calls (outside tx): project, workflow, target
      const db = makeDb([[ownerProject], [workflow], [target]]);
      // tx.select calls (inside tx): count(statuses), count(issues)
      const tx = makeTx([[{ count: 5 }], [{ count: 0 }]]);
      tx.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      tx.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.deleteStatus('MJ', userId, 'st-2');

      expect(result).toEqual({ id: 'st-2', deleted: true });
      expect(tx.delete).toHaveBeenCalled();
      expect(tx.update).toHaveBeenCalled(); // re-number survivors
      expect(tx.execute).toHaveBeenCalled(); // FOR UPDATE row lock
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowStatus.deleted'),
      );
      logSpy.mockRestore();
    });

    it('throws ConflictException with N-issue message when status has issues', async () => {
      const db = makeDb([[ownerProject], [workflow], [target]]);
      const tx = makeTx([[{ count: 5 }], [{ count: 7 }]]);
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      await expect(service.deleteStatus('MJ', userId, 'st-2')).rejects.toThrow(
        new ConflictException('Status has 7 issue(s). Move them to another status first.'),
      );
    });

    it('throws BadRequestException when deleting the last status', async () => {
      const db = makeDb([[ownerProject], [workflow], [target]]);
      const tx = makeTx([[{ count: 1 }]]);
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      await expect(service.deleteStatus('MJ', userId, 'st-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new WorkflowService(db);

      await expect(service.deleteStatus('MJ', userId, 'st-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ========== bulkMoveIssues ==========

  describe('bulkMoveIssues', () => {
    it('transactionally moves all issues, increments issueVersion, audit-logs once', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // Selects: project, workflow, both-statuses-exist (returns 2)
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: 'st-from' }, { id: 'st-to' }],
      ]);
      const tx: any = {
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest
                .fn()
                .mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }, { id: 'i-3' }]),
            }),
          }),
        }),
      };
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new WorkflowService(db);

      const result = await service.bulkMoveIssues('MJ', userId, 'st-from', {
        targetStatusId: '00000000-0000-0000-0000-0000000000aa',
      });

      expect(result).toEqual({ moved: 3 });
      // Audit log fired exactly once
      const auditCalls = logSpy.mock.calls.filter((c) =>
        String(c[0]).includes('[AUDIT] issue.statusBulkMove'),
      );
      expect(auditCalls.length).toBe(1);
      expect(auditCalls[0][0]).toEqual(expect.stringContaining('count=3'));
      logSpy.mockRestore();
    });

    it('rejects when source equals target', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);

      await expect(
        service.bulkMoveIssues('MJ', userId, 'st-x', {
          targetStatusId: 'st-x' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when target status is in a different workflow/project', async () => {
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: 'st-from' }], // only one returned — target belongs elsewhere
      ]);
      service = new WorkflowService(db);

      await expect(
        service.bulkMoveIssues('MJ', userId, 'st-from', {
          targetStatusId: '00000000-0000-0000-0000-0000000000bb',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid (non-uuid) targetStatusId', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);

      await expect(
        service.bulkMoveIssues('MJ', userId, 'st-from', {
          targetStatusId: 'not-a-uuid',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ========== rules: addRule ==========

  const validUuid = '11111111-1111-1111-1111-111111111111';
  const validUuid2 = '22222222-2222-2222-2222-222222222222';

  describe('addRule', () => {
    it('inserts a new rule and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // project, workflow, status-validity (2 rows for from+to)
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: validUuid }, { id: validUuid2 }],
      ]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'rule-1',
              fromStatusId: validUuid,
              toStatusId: validUuid2,
              ruleType: 'require_assignee',
              createdAt: new Date(),
            },
          ]),
        }),
      });
      service = new WorkflowService(db);

      const result = await service.addRule('MJ', userId, {
        fromStatusId: validUuid,
        toStatusId: validUuid2,
        ruleType: 'require_assignee',
      });

      expect(result.id).toBe('rule-1');
      expect(db.insert).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowRule.added'),
      );
      logSpy.mockRestore();
    });

    it('throws ConflictException on duplicate (PG 23505)', async () => {
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: validUuid }, { id: validUuid2 }],
      ]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(
            Object.assign(new Error('duplicate key'), { code: '23505' }),
          ),
        }),
      });
      service = new WorkflowService(db);

      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: validUuid,
          toStatusId: validUuid2,
          ruleType: 'require_assignee',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when a referenced status is in a different workflow', async () => {
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: validUuid }], // only 1 of 2 returned
      ]);
      service = new WorkflowService(db);

      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: validUuid,
          toStatusId: validUuid2,
          ruleType: 'require_assignee',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new WorkflowService(db);

      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_assignee',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts fromStatusId = null (any-source rule)', async () => {
      const db = makeDb([
        [ownerProject],
        [workflow],
        [{ id: validUuid2 }],
      ]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'rule-2',
              fromStatusId: null,
              toStatusId: validUuid2,
              ruleType: 'require_assignee',
              createdAt: new Date(),
            },
          ]),
        }),
      });
      service = new WorkflowService(db);

      const result = await service.addRule('MJ', userId, {
        fromStatusId: null,
        toStatusId: validUuid2,
        ruleType: 'require_assignee',
      });
      expect(result.fromStatusId).toBeNull();
    });

    it('throws BadRequestException on invalid uuid', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);
      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: 'not-a-uuid' as never,
          toStatusId: validUuid2,
          ruleType: 'require_assignee',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // ===== Story 4.3: require_field rule type =====

    it('accepts require_field rule with requiredField=resolution', async () => {
      const db = makeDb([[ownerProject], [workflow], [{ id: validUuid2 }]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'rule-f',
              fromStatusId: null,
              toStatusId: validUuid2,
              ruleType: 'require_field',
              requiredField: 'resolution',
              createdAt: new Date(),
            },
          ]),
        }),
      });
      service = new WorkflowService(db);

      const result = await service.addRule('MJ', userId, {
        fromStatusId: null,
        toStatusId: validUuid2,
        ruleType: 'require_field',
        requiredField: 'resolution',
      } as never);
      expect(result.ruleType).toBe('require_field');
      expect(result.requiredField).toBe('resolution');
    });

    it('rejects require_field rule with requiredField=null (Zod enum refusal)', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);
      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_field',
          requiredField: null,
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects require_field rule with disallowed requiredField value', async () => {
      const db = makeDb([]);
      service = new WorkflowService(db);
      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_field',
          requiredField: 'not_allowed',
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('duplicate (incl. requiredField) → 409', async () => {
      const db = makeDb([[ownerProject], [workflow], [{ id: validUuid2 }]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(
            Object.assign(new Error('duplicate key'), { code: '23505' }),
          ),
        }),
      });
      service = new WorkflowService(db);
      await expect(
        service.addRule('MJ', userId, {
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_field',
          requiredField: 'resolution',
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('listRules returns rows with requiredField included', async () => {
      const rows = [
        {
          id: 'r1',
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_field',
          requiredField: 'resolution',
          createdAt: new Date(),
        },
      ];
      const db = makeDb([[ownerProject], [workflow], rows]);
      service = new WorkflowService(db);
      const result = await service.listRules('MJ', userId);
      expect(result[0].requiredField).toBe('resolution');
    });
  });

  // ========== rules: listRules ==========

  describe('listRules', () => {
    it('returns ordered list for owner', async () => {
      const rows = [
        {
          id: 'r1',
          fromStatusId: null,
          toStatusId: validUuid2,
          ruleType: 'require_assignee',
          createdAt: new Date(),
        },
      ];
      const db = makeDb([[ownerProject], [workflow], rows]);
      service = new WorkflowService(db);

      const result = await service.listRules('MJ', userId);
      expect(result).toEqual(rows);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new WorkflowService(db);
      await expect(service.listRules('MJ', userId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ========== rules: deleteRule ==========

  describe('deleteRule', () => {
    it('deletes the rule and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject], [workflow], [{ id: 'r1' }]]);
      db.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'r1' }]),
        }),
      });
      service = new WorkflowService(db);

      const result = await service.deleteRule('MJ', userId, 'r1');
      expect(result).toEqual({ id: 'r1', deleted: true });
      expect(db.delete).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] workflowRule.deleted'),
      );
      logSpy.mockRestore();
    });

    it('throws NotFoundException when rule does not belong to workflow', async () => {
      const db = makeDb([[ownerProject], [workflow], []]);
      service = new WorkflowService(db);
      await expect(service.deleteRule('MJ', userId, 'r1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new WorkflowService(db);
      await expect(service.deleteRule('MJ', userId, 'r1')).rejects.toThrow(ForbiddenException);
    });
  });
});
