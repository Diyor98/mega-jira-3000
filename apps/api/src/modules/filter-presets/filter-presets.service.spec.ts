import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FilterPresetsService } from './filter-presets.service';

/**
 * Small queue-based mock builder. Each `db.select()` call dequeues one
 * result so the service's sequential SELECTs (project → preset row) can be
 * scripted independently.
 */
function buildChain(result: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(result),
        orderBy: jest.fn().mockResolvedValue(result),
        then: (resolve: (v: unknown[]) => unknown) =>
          Promise.resolve(result).then(resolve),
      }),
    }),
  };
}

function makeDb(queue: unknown[][]) {
  let i = 0;
  const db: any = {
    select: jest.fn().mockImplementation(() => {
      const next = queue[i] ?? [];
      i++;
      return buildChain(next);
    }),
    insert: jest.fn(),
    delete: jest.fn(),
  };
  return db;
}

describe('FilterPresetsService', () => {
  const userId = 'user-1';
  const ownerProject = { id: 'proj-1', key: 'MJ', ownerId: userId };
  const otherProject = { id: 'proj-1', key: 'MJ', ownerId: 'someone-else' };

  const validConfig = {
    statusIds: [],
    assigneeIds: [],
    types: [],
    priorities: [],
    createdFrom: null,
    createdTo: null,
  };

  let service: FilterPresetsService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== create =====

  describe('create', () => {
    it('inserts a preset and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'p1',
              name: 'My P1 bugs',
              filterConfig: validConfig,
              createdAt: new Date(),
            },
          ]),
        }),
      });
      service = new FilterPresetsService(db);

      const result = await service.create('MJ', userId, {
        name: 'My P1 bugs',
        filterConfig: validConfig,
      });

      expect(result.id).toBe('p1');
      expect(result.name).toBe('My P1 bugs');
      expect(db.insert).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] filterPreset.created'),
      );
      logSpy.mockRestore();
    });

    it('throws ConflictException on duplicate-name (PG 23505)', async () => {
      const db = makeDb([[ownerProject]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(
            Object.assign(new Error('duplicate key'), { code: '23505' }),
          ),
        }),
      });
      service = new FilterPresetsService(db);

      await expect(
        service.create('MJ', userId, { name: 'Dupe', filterConfig: validConfig }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException on empty name', async () => {
      const db = makeDb([]);
      service = new FilterPresetsService(db);
      await expect(
        service.create('MJ', userId, { name: '', filterConfig: validConfig }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on name > 100 chars', async () => {
      const db = makeDb([]);
      service = new FilterPresetsService(db);
      await expect(
        service.create('MJ', userId, {
          name: 'x'.repeat(101),
          filterConfig: validConfig,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on invalid filterConfig enum', async () => {
      const db = makeDb([]);
      service = new FilterPresetsService(db);
      await expect(
        service.create('MJ', userId, {
          name: 'Bad',
          filterConfig: {
            ...validConfig,
            priorities: ['P9' as never],
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for non-owner of project', async () => {
      const db = makeDb([[otherProject]]);
      service = new FilterPresetsService(db);
      await expect(
        service.create('MJ', userId, { name: 'x', filterConfig: validConfig }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      const db = makeDb([[]]);
      service = new FilterPresetsService(db);
      await expect(
        service.create('NOPE', userId, { name: 'x', filterConfig: validConfig }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ===== list =====

  describe('list', () => {
    it('returns caller-scoped presets ordered by name', async () => {
      const rows = [
        { id: 'p1', name: 'A', filterConfig: validConfig, createdAt: new Date() },
        { id: 'p2', name: 'B', filterConfig: validConfig, createdAt: new Date() },
      ];
      const db = makeDb([[ownerProject], rows]);
      service = new FilterPresetsService(db);

      const result = await service.list('MJ', userId);
      expect(result).toEqual(rows);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new FilterPresetsService(db);
      await expect(service.list('MJ', userId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ===== delete =====

  describe('delete', () => {
    it('deletes the preset and audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject], [{ id: 'p1', name: 'My preset' }]]);
      db.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'p1' }]),
        }),
      });
      service = new FilterPresetsService(db);

      const result = await service.delete('MJ', userId, 'p1');
      expect(result).toEqual({ id: 'p1', deleted: true });
      expect(db.delete).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] filterPreset.deleted'),
      );
      logSpy.mockRestore();
    });

    it('throws NotFoundException for another user\'s preset (no existence leak)', async () => {
      // Project access passes, but the preset lookup scoped by (id, user_id)
      // returns empty because the preset belongs to someone else.
      const db = makeDb([[ownerProject], []]);
      service = new FilterPresetsService(db);
      await expect(service.delete('MJ', userId, 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner of project', async () => {
      const db = makeDb([[otherProject]]);
      service = new FilterPresetsService(db);
      await expect(service.delete('MJ', userId, 'p1')).rejects.toThrow(ForbiddenException);
    });

    it('treats 0-row DELETE (concurrent race) as success without audit', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject], [{ id: 'p1', name: 'My preset' }]]);
      db.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      });
      service = new FilterPresetsService(db);

      const result = await service.delete('MJ', userId, 'p1');
      expect(result).toEqual({ id: 'p1', deleted: true });
      // No audit line on concurrent race — don't mislead operators.
      const auditCalls = logSpy.mock.calls.filter((c) =>
        String(c[0]).includes('[AUDIT] filterPreset.deleted'),
      );
      expect(auditCalls.length).toBe(0);
      logSpy.mockRestore();
    });
  });
});
