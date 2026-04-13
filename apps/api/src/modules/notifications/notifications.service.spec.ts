import { NotFoundException, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function makeDb() {
  const selectCalls: any[] = [];
  const db: any = {
    select: jest.fn().mockImplementation((projection?: unknown) => {
      const chain: any = {
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
            then: (resolve: (v: unknown[]) => unknown) =>
              Promise.resolve([]).then(resolve),
          }),
        }),
      };
      selectCalls.push({ projection, chain });
      return chain;
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
    update: jest.fn(),
  };
  return { db, selectCalls };
}

describe('NotificationsService', () => {
  const userId = 'user-1';
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== createBulk =====

  describe('createBulk', () => {
    it('inserts multiple rows when given a non-empty array', async () => {
      const { db } = makeDb();
      service = new NotificationsService(db);

      await service.createBulk(db, [
        { userId: 'u1', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
        { userId: 'u2', type: 'assigned', issueId: 'i2', actorId: 'a2' },
      ]);

      expect(db.insert).toHaveBeenCalled();
    });

    it('is a no-op when given an empty array', async () => {
      const { db } = makeDb();
      service = new NotificationsService(db);

      await service.createBulk(db, []);

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('swallows insert errors without throwing (fail-soft)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { db } = makeDb();
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockRejectedValue(new Error('db exploded')),
      });
      service = new NotificationsService(db);

      // Must not throw
      await expect(
        service.createBulk(db, [
          { userId: 'u1', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
        ]),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] notification.insertFailed'),
      );
      warnSpy.mockRestore();
    });

    // Story 6.4: preference filter inside createBulk.
    // Helper: mock the prefs SELECT (returns a fixed list) and capture the
    // insert values to assert which rows survived the filter.
    function setupPrefsAndCaptureInsert(
      prefsRows: Array<{
        userId: string;
        mentioned: boolean;
        assigned: boolean;
        statusChanged: boolean;
      }>,
    ) {
      const db = makeDb().db;
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(prefsRows),
        }),
      });
      const valuesSpy = jest.fn().mockResolvedValue(undefined);
      db.insert = jest.fn().mockReturnValue({ values: valuesSpy });
      return { db, valuesSpy };
    }

    it('drops rows whose recipient has the type disabled', async () => {
      const { db, valuesSpy } = setupPrefsAndCaptureInsert([
        { userId: 'u1', mentioned: true, assigned: true, statusChanged: false },
      ]);
      service = new NotificationsService(db);

      await service.createBulk(db, [
        { userId: 'u1', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
        { userId: 'u1', type: 'status_changed', issueId: 'i2', actorId: 'a1' },
      ]);

      // Only the `mentioned` row should have reached the insert.
      expect(valuesSpy).toHaveBeenCalledTimes(1);
      const inserted = valuesSpy.mock.calls[0][0];
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ userId: 'u1', type: 'mentioned' });
    });

    it('respects per-type disables across multiple recipients', async () => {
      const { db, valuesSpy } = setupPrefsAndCaptureInsert([
        { userId: 'u1', mentioned: false, assigned: true, statusChanged: true },
        { userId: 'u2', mentioned: true, assigned: true, statusChanged: true },
      ]);
      service = new NotificationsService(db);

      await service.createBulk(db, [
        { userId: 'u1', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
        { userId: 'u2', type: 'mentioned', issueId: 'i2', actorId: 'a2' },
      ]);

      // Only u2's mention should land — u1 muted mentions.
      const inserted = valuesSpy.mock.calls[0][0];
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ userId: 'u2', type: 'mentioned' });
    });

    it('treats users with no prefs row as all-enabled (default)', async () => {
      // Empty prefs result — mimics a brand-new user with no row.
      const { db, valuesSpy } = setupPrefsAndCaptureInsert([]);
      service = new NotificationsService(db);

      await service.createBulk(db, [
        { userId: 'u-new', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
        { userId: 'u-new', type: 'assigned', issueId: 'i2', actorId: 'a1' },
        { userId: 'u-new', type: 'status_changed', issueId: 'i3', actorId: 'a1' },
      ]);

      const inserted = valuesSpy.mock.calls[0][0];
      expect(inserted).toHaveLength(3);
    });

    it('short-circuits when the filtered list is empty (no insert)', async () => {
      const { db, valuesSpy } = setupPrefsAndCaptureInsert([
        { userId: 'u1', mentioned: false, assigned: false, statusChanged: false },
      ]);
      service = new NotificationsService(db);

      await service.createBulk(db, [
        { userId: 'u1', type: 'mentioned', issueId: 'i1', actorId: 'a1' },
      ]);

      expect(valuesSpy).not.toHaveBeenCalled();
    });
  });

  // ===== listForUser =====

  describe('listForUser', () => {
    it('queries notifications with the three joins (issues, projects, users)', async () => {
      const { db } = makeDb();
      // Override the deep chain to return a row shape matching the service's projection.
      const limitFn = jest.fn().mockResolvedValue([
        {
          id: 'n1',
          type: 'mentioned',
          issueId: 'i1',
          issueKey: 'MJ-1',
          issueTitle: 'bug',
          projectKey: 'MJ',
          commentId: 'c1',
          actorId: 'alice',
          actorEmail: 'alice@x.io',
          readAt: null,
          createdAt: new Date(),
        },
      ]);
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockReturnValue({
                    limit: limitFn,
                  }),
                }),
              }),
            }),
          }),
        }),
      });
      service = new NotificationsService(db);

      const result = await service.listForUser(userId);
      expect(result).toHaveLength(1);
      expect(result[0].issueKey).toBe('MJ-1');
      expect(result[0].actorEmail).toBe('alice@x.io');
      expect(limitFn).toHaveBeenCalledWith(50);
    });
  });

  // ===== unreadCount =====

  describe('unreadCount', () => {
    it('returns the count from the aggregate select', async () => {
      const { db } = makeDb();
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: 7 }]),
        }),
      });
      service = new NotificationsService(db);

      const result = await service.unreadCount(userId);
      expect(result).toEqual({ count: 7 });
    });

    it('returns count=0 when the aggregate row is missing', async () => {
      const { db } = makeDb();
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });
      service = new NotificationsService(db);
      const result = await service.unreadCount(userId);
      expect(result).toEqual({ count: 0 });
    });
  });

  // ===== markRead =====

  describe('markRead', () => {
    it('marks the caller\'s own notification read', async () => {
      const { db } = makeDb();
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'n1' }]),
          }),
        }),
      });
      const updateChain = {
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      };
      db.update = jest.fn().mockReturnValue(updateChain);
      service = new NotificationsService(db);

      const result = await service.markRead(userId, 'n1');
      expect(result.id).toBe('n1');
      expect(db.update).toHaveBeenCalled();
    });

    it('throws NotFoundException for another user\'s notification (no existence leak)', async () => {
      const { db } = makeDb();
      db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      service = new NotificationsService(db);

      await expect(service.markRead(userId, 'n-other')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ===== markAllRead =====

  describe('markAllRead', () => {
    it('bulk-updates only the caller\'s unread rows and returns the count', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { db } = makeDb();
      db.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]),
          }),
        }),
      });
      service = new NotificationsService(db);

      const result = await service.markAllRead(userId);
      expect(result).toEqual({ count: 3 });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] notification.markAllRead'),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('count=3'));
      logSpy.mockRestore();
    });

    it('returns count=0 when the caller has no unread notifications', async () => {
      const { db } = makeDb();
      db.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      service = new NotificationsService(db);

      const result = await service.markAllRead(userId);
      expect(result).toEqual({ count: 0 });
    });
  });
});
