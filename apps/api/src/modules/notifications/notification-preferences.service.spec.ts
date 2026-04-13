import { BadRequestException, Logger } from '@nestjs/common';
import { NotificationPreferencesService } from './notification-preferences.service';

function makeDb() {
  const db: any = {
    select: jest.fn(),
    insert: jest.fn(),
  };
  return db;
}

describe('NotificationPreferencesService', () => {
  const userId = 'user-1';
  let service: NotificationPreferencesService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== get =====

  describe('get', () => {
    it('returns defaults (all true) when no row exists', async () => {
      const db = makeDb();
      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      service = new NotificationPreferencesService(db);

      const result = await service.get(userId);
      expect(result).toEqual({
        mentioned: true,
        assigned: true,
        status_changed: true,
      });
    });

    it('returns stored values when a row exists', async () => {
      const db = makeDb();
      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              { mentioned: true, assigned: false, statusChanged: false },
            ]),
          }),
        }),
      });
      service = new NotificationPreferencesService(db);

      const result = await service.get(userId);
      expect(result).toEqual({
        mentioned: true,
        assigned: false,
        status_changed: false,
      });
    });
  });

  // ===== update =====

  describe('update', () => {
    function setupUpsert(returnedRow: {
      mentioned: boolean;
      assigned: boolean;
      statusChanged: boolean;
    }) {
      const db = makeDb();
      const onConflictDoUpdate = jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([returnedRow]),
      });
      const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert = jest.fn().mockReturnValue({ values });
      return { db, onConflictDoUpdate, values };
    }

    it('upserts a new row with defaults for unspecified fields', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { db } = setupUpsert({
        mentioned: true,
        assigned: true,
        statusChanged: false,
      });
      service = new NotificationPreferencesService(db);

      const result = await service.update(userId, { status_changed: false });
      expect(result).toEqual({
        mentioned: true,
        assigned: true,
        status_changed: false,
      });
      expect(db.insert).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] notificationPreferences.updated'),
      );
      logSpy.mockRestore();
    });

    it('merges partial PATCHes — only provided fields go into the update set', async () => {
      const { db, onConflictDoUpdate } = setupUpsert({
        mentioned: false,
        assigned: true,
        statusChanged: true,
      });
      service = new NotificationPreferencesService(db);

      await service.update(userId, { mentioned: false });

      // The onConflict update-set should only contain `mentioned` + `updatedAt`,
      // not `assigned` or `statusChanged` (which would clobber existing values).
      const call = onConflictDoUpdate.mock.calls[0][0];
      expect(call.set).toHaveProperty('mentioned', false);
      expect(call.set).toHaveProperty('updatedAt');
      expect(call.set).not.toHaveProperty('assigned');
      expect(call.set).not.toHaveProperty('statusChanged');
    });

    it('throws BadRequestException on empty body (Zod refine)', async () => {
      const db = makeDb();
      service = new NotificationPreferencesService(db);
      await expect(service.update(userId, {} as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException on non-boolean field', async () => {
      const db = makeDb();
      service = new NotificationPreferencesService(db);
      await expect(
        service.update(userId, { mentioned: 'yes' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('audit-logs the changed field names', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { db } = setupUpsert({
        mentioned: false,
        assigned: false,
        statusChanged: true,
      });
      service = new NotificationPreferencesService(db);

      await service.update(userId, { mentioned: false, assigned: false });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('changedFields=[mentioned,assigned]'),
      );
      logSpy.mockRestore();
    });
  });
});
