import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { CommentsService } from './comments.service';

function buildChain(result: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(result),
        orderBy: jest.fn().mockResolvedValue(result),
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
  };
  return db;
}

const mockEventService: any = {
  emitCommentCreated: jest.fn(),
};

describe('CommentsService', () => {
  const userId = 'user-1';
  const ownerProject = { id: 'proj-1', key: 'MJ', ownerId: userId };
  const otherProject = { id: 'proj-1', key: 'MJ', ownerId: 'someone-else' };
  const issueRow = { id: 'issue-1', issueKey: 'MJ-1' };

  let service: CommentsService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== create =====

  describe('create', () => {
    it('inserts a comment, emits WS event, audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject], [issueRow]]);
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'c1',
              issueId: 'issue-1',
              authorId: userId,
              body: 'Looks good',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      });
      service = new CommentsService(db, mockEventService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: 'Looks good',
      });

      expect(result.id).toBe('c1');
      expect(result.body).toBe('Looks good');
      expect(db.insert).toHaveBeenCalled();
      expect(mockEventService.emitCommentCreated).toHaveBeenCalledWith(
        'MJ',
        expect.objectContaining({
          issueId: 'issue-1',
          comment: expect.objectContaining({ id: 'c1' }),
          actorId: userId,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] comment.created'),
      );
      logSpy.mockRestore();
    });

    it('throws BadRequestException on empty body', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on whitespace-only body (post-trim)', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: '   \n\t  ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on body > 10000 chars', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'x'.repeat(10001) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const db = makeDb([[ownerProject], []]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      const db = makeDb([[]]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('NOPE', 'issue-1', userId, { body: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner of project', async () => {
      const db = makeDb([[otherProject]]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'Hi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('stores the trimmed body (leading/trailing whitespace stripped)', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      let captured: unknown = null;
      db.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((vals: any) => {
          captured = vals;
          return {
            returning: jest.fn().mockResolvedValue([
              {
                id: 'c2',
                issueId: 'issue-1',
                authorId: userId,
                body: vals.body,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
          };
        }),
      });
      service = new CommentsService(db, mockEventService);

      await service.create('MJ', 'issue-1', userId, { body: '  hello  ' });
      expect((captured as { body: string }).body).toBe('hello');
    });
  });

  // ===== listByIssue =====

  describe('listByIssue', () => {
    it('returns comments ordered by createdAt ASC', async () => {
      const rows = [
        {
          id: 'c1',
          issueId: 'issue-1',
          authorId: userId,
          body: 'first',
          createdAt: new Date('2026-04-01'),
          updatedAt: new Date('2026-04-01'),
        },
        {
          id: 'c2',
          issueId: 'issue-1',
          authorId: userId,
          body: 'second',
          createdAt: new Date('2026-04-02'),
          updatedAt: new Date('2026-04-02'),
        },
      ];
      const db = makeDb([[ownerProject], [issueRow], rows]);
      service = new CommentsService(db, mockEventService);

      const result = await service.listByIssue('MJ', 'issue-1', userId);
      expect(result).toEqual(rows);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const db = makeDb([[ownerProject], []]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.listByIssue('MJ', 'issue-1', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new CommentsService(db, mockEventService);
      await expect(
        service.listByIssue('MJ', 'issue-1', userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
