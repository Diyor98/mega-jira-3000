import {
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createRbacDenyMock } from '../../test-utils/rbac-mock';

// Mock node:fs — must happen BEFORE importing the service.
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
  },
  createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
  constants: { R_OK: 4, F_OK: 0 },
}));

// eslint-disable-next-line import/first
import { AttachmentsService } from './attachments.service';
// eslint-disable-next-line import/first
import { promises as fs, createReadStream } from 'fs';

function buildChain(result: unknown[]) {
  const whereReturn = {
    limit: jest.fn().mockResolvedValue(result),
    orderBy: jest.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown[]) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  const joinReturn = {
    where: jest.fn().mockReturnValue(whereReturn),
  };
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue(whereReturn),
      innerJoin: jest.fn().mockReturnValue(joinReturn),
      leftJoin: jest.fn().mockReturnValue(joinReturn),
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

describe('AttachmentsService', () => {
  const userId = 'user-1';
  const ownerProject = { id: 'proj-1', key: 'MJ', ownerId: userId };
  const otherProject = { id: 'proj-1', key: 'MJ', ownerId: 'someone-else' };
  const issueRow = { id: 'issue-1', issueKey: 'MJ-1' };

  let service: AttachmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function smallPng(): any {
    return {
      originalname: 'screenshot.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    };
  }

  // ===== create =====

  describe('create', () => {
    it('writes the file to disk, inserts the row, returns hydrated response', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      // Queue: project, issue, uploader-email
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [{ email: 'alice@x.io' }],
      ]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'att-1',
              issueId: 'issue-1',
              uploadedBy: userId,
              fileName: 'screenshot.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              createdAt: new Date(),
            },
          ]),
        }),
      });
      service = new AttachmentsService(db);

      const result = await service.create('MJ', 'issue-1', userId, smallPng());

      expect(result.id).toBe('att-1');
      expect(result.uploadedByEmail).toBe('alice@x.io');
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] attachment.created'),
      );
      logSpy.mockRestore();
    });

    it('rejects oversized file with PayloadTooLargeException', async () => {
      const db = makeDb([]);
      service = new AttachmentsService(db);
      const huge = { ...smallPng(), size: 100 * 1024 * 1024 };
      await expect(
        service.create('MJ', 'issue-1', userId, huge),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects disallowed MIME with UnsupportedMediaTypeException', async () => {
      const db = makeDb([]);
      service = new AttachmentsService(db);
      const exe = { ...smallPng(), mimetype: 'application/x-msdownload' };
      await expect(
        service.create('MJ', 'issue-1', userId, exe),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('compensates — unlinks the orphan file when the DB insert throws', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(new Error('db unreachable')),
        }),
      });
      service = new AttachmentsService(db);

      await expect(
        service.create('MJ', 'issue-1', userId, smallPng()),
      ).rejects.toThrow('db unreachable');

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('RBAC: denies via assertAction', async () => {
      const db = makeDb([]);
      service = new AttachmentsService(
        db,
        undefined,
        createRbacDenyMock('attachment.upload') as any,
      );
      await expect(
        service.create('MJ', 'issue-1', userId, smallPng()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const db = makeDb([[ownerProject], []]);
      service = new AttachmentsService(db);
      await expect(
        service.create('MJ', 'issue-1', userId, smallPng()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      const db = makeDb([[]]);
      service = new AttachmentsService(db);
      await expect(
        service.create('NOPE', 'issue-1', userId, smallPng()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ===== listByIssue =====

  describe('listByIssue', () => {
    it('returns hydrated attachment rows ordered by createdAt DESC', async () => {
      const attachmentsRows = [
        {
          id: 'a1',
          issueId: 'issue-1',
          uploadedBy: userId,
          uploadedByEmail: 'alice@x.io',
          fileName: 'design.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          createdAt: new Date(),
        },
      ];
      const db = makeDb([[ownerProject], [issueRow], attachmentsRows]);
      service = new AttachmentsService(db);

      const result = await service.listByIssue('MJ', 'issue-1', userId);
      expect(result).toEqual(attachmentsRows);
    });

    it('RBAC: denies via assertAction', async () => {
      const db = makeDb([]);
      service = new AttachmentsService(
        db,
        undefined,
        createRbacDenyMock('project.read') as any,
      );
      await expect(
        service.listByIssue('MJ', 'issue-1', userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ===== getFileStream =====

  describe('getFileStream', () => {
    it('returns a StreamableFile when row + file exist', async () => {
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [
          {
            id: 'att-1',
            storedName: 'uuid.png',
            fileName: 'screenshot.png',
            mimeType: 'image/png',
          },
        ],
      ]);
      service = new AttachmentsService(db);
      (fs.access as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await service.getFileStream('MJ', 'issue-1', 'att-1', userId);
      expect(result).toBeInstanceOf(StreamableFile);
      expect(createReadStream).toHaveBeenCalled();
    });

    it('throws NotFoundException when the DB row is missing', async () => {
      const db = makeDb([[ownerProject], [issueRow], []]);
      service = new AttachmentsService(db);
      await expect(
        service.getFileStream('MJ', 'issue-1', 'att-1', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a stored_name containing `../` (path-traversal defense)', async () => {
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [
          {
            id: 'att-1',
            storedName: '../../etc/passwd',
            fileName: 'innocent.png',
            mimeType: 'image/png',
          },
        ],
      ]);
      service = new AttachmentsService(db);
      await expect(
        service.getFileStream('MJ', 'issue-1', 'att-1', userId),
      ).rejects.toThrow(/Invalid attachment path/);
    });

    it('throws NotFoundException + warn-logs when the file is missing on disk', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [{ id: 'att-1', storedName: 'uuid.png', fileName: 'x.png', mimeType: 'image/png' }],
      ]);
      (fs.access as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );
      service = new AttachmentsService(db);

      await expect(
        service.getFileStream('MJ', 'issue-1', 'att-1', userId),
      ).rejects.toThrow(NotFoundException);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] attachment.fileMissing'),
      );
      warnSpy.mockRestore();
    });
  });

  // ===== delete =====

  describe('delete', () => {
    it('unlinks the file, deletes the DB row, audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [{ id: 'att-1', storedName: 'uuid.png', fileName: 'x.png' }],
      ]);
      db.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      service = new AttachmentsService(db);

      const result = await service.delete('MJ', 'issue-1', 'att-1', userId);

      expect(result).toEqual({ id: 'att-1', deleted: true });
      expect(fs.unlink).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] attachment.deleted'),
      );
      logSpy.mockRestore();
    });

    it('swallows ENOENT when the file is already missing', async () => {
      const db = makeDb([
        [ownerProject],
        [issueRow],
        [{ id: 'att-1', storedName: 'uuid.png', fileName: 'x.png' }],
      ]);
      db.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      (fs.unlink as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );
      service = new AttachmentsService(db);

      const result = await service.delete('MJ', 'issue-1', 'att-1', userId);
      expect(result.deleted).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException when the attachment row does not exist', async () => {
      const db = makeDb([[ownerProject], [issueRow], []]);
      service = new AttachmentsService(db);
      await expect(
        service.delete('MJ', 'issue-1', 'att-1', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('RBAC: denies via assertAction', async () => {
      const db = makeDb([]);
      service = new AttachmentsService(
        db,
        undefined,
        createRbacDenyMock('attachment.delete') as any,
      );
      await expect(
        service.delete('MJ', 'issue-1', 'att-1', userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
