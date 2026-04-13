import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { CommentsService, extractMentions } from './comments.service';

/**
 * Build a flexible chain result for `db.select()`. The service uses these
 * terminal shapes:
 *   select().from().where().limit()                  — project/issue lookups
 *   select().from().where().orderBy()                — listByIssue comments
 *   select().from().innerJoin().where()              — listByIssue mentions
 */
function buildChain(result: unknown[]) {
  const whereReturn = {
    limit: jest.fn().mockResolvedValue(result),
    orderBy: jest.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown[]) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue(whereReturn),
      innerJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue(whereReturn),
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
    transaction: jest.fn(),
  };
  return db;
}

/**
 * Build a transaction object scripted with the same select queue shape.
 * The tx body of `create` uses:
 *   tx.insert(comments).values().returning()                 — comment row
 *   tx.select(users).from().where()                          — mention resolve
 *   tx.insert(commentMentions).values().onConflictDoNothing()
 */
function makeTx(opts: {
  insertedComment: unknown;
  resolvedUsers?: unknown[];
}) {
  const resolvedUsers = opts.resolvedUsers ?? [];
  const mentionInsertSpy = jest.fn().mockReturnValue({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
    }),
  });
  // First insert() call in tx → comments; second → commentMentions. Queue
  // them so the service hits the right shape each time.
  let insertCall = 0;
  const tx: any = {
    insert: jest.fn().mockImplementation(() => {
      insertCall++;
      if (insertCall === 1) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([opts.insertedComment]),
          }),
        };
      }
      return mentionInsertSpy();
    }),
    select: jest.fn().mockImplementation(() => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(resolvedUsers),
      }),
    })),
  };
  return { tx, mentionInsertSpy };
}

const mockEventService: any = {
  emitCommentCreated: jest.fn(),
};

const mockNotificationsService: any = {
  createBulk: jest.fn().mockResolvedValue(undefined),
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

  // ===== extractMentions (pure helper) =====

  describe('extractMentions', () => {
    it('extracts a simple mention after leading whitespace', () => {
      expect(extractMentions('Hey @alice please review')).toEqual(['alice']);
    });

    it('dedups repeated handles', () => {
      expect(extractMentions('@alice and @alice and @bob')).toEqual(['alice', 'bob']);
    });

    it('lowercases handles', () => {
      expect(extractMentions('@Alice @BOB')).toEqual(['alice', 'bob']);
    });

    it('does NOT match inside email addresses', () => {
      expect(extractMentions('contact foo@bar.com for help')).toEqual([]);
    });

    it('matches at the start of string', () => {
      expect(extractMentions('@alice ping')).toEqual(['alice']);
    });

    it('matches after punctuation', () => {
      expect(extractMentions('(@bob) or @carol.')).toEqual(['bob', 'carol']);
    });

    it('returns empty for body with no mentions', () => {
      expect(extractMentions('just a regular comment')).toEqual([]);
    });
  });

  // ===== create =====

  describe('create', () => {
    const baseComment = {
      id: 'c1',
      issueId: 'issue-1',
      authorId: userId,
      body: 'Looks good',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('inserts a comment with no mentions, emits WS event, audit-logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx } = makeTx({ insertedComment: baseComment });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: 'Looks good',
      });

      expect(result.id).toBe('c1');
      expect(result.mentions).toEqual([]);
      expect(mockEventService.emitCommentCreated).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT] comment.created'),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mentionCount=0'));
      logSpy.mockRestore();
    });

    it('mention fires a notification for each resolved user except the author', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx } = makeTx({
        insertedComment: { ...baseComment, body: '@alice @bob' },
        resolvedUsers: [
          { id: 'u-alice', email: 'alice@x.io' },
          { id: 'u-bob', email: 'bob@x.io' },
        ],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      await service.create('MJ', 'issue-1', userId, { body: '@alice @bob' });

      // Post-Story-6.3-review: the mention trigger runs AFTER the tx commits
      // with `this.db`, not the tx handle — fail-soft semantics.
      expect(mockNotificationsService.createBulk).toHaveBeenCalledWith(
        db,
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'u-alice',
            type: 'mentioned',
            actorId: userId,
          }),
          expect.objectContaining({
            userId: 'u-bob',
            type: 'mentioned',
            actorId: userId,
          }),
        ]),
      );
    });

    it('self-mention is filtered from notifications (author mentions themselves)', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx } = makeTx({
        insertedComment: { ...baseComment, body: '@self oops' },
        // `userId` is 'user-1' — resolved user shares that id.
        resolvedUsers: [{ id: userId, email: 'self@x.io' }],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      await service.create('MJ', 'issue-1', userId, { body: '@self oops' });

      // createBulk is called but with an empty array (author filtered out).
      const calls = mockNotificationsService.createBulk.mock.calls;
      if (calls.length > 0) {
        // If invoked, the rows array must be empty — nothing notifies self.
        const lastCall = calls[calls.length - 1];
        expect(lastCall[1]).toEqual([]);
      }
    });

    it('resolves a single @alice mention → 1 mention row, returns mentions array', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx, mentionInsertSpy } = makeTx({
        insertedComment: { ...baseComment, body: 'Hey @alice please' },
        resolvedUsers: [{ id: 'u-alice', email: 'alice@example.com' }],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: 'Hey @alice please',
      });

      expect(result.mentions).toEqual([
        { userId: 'u-alice', email: 'alice@example.com' },
      ]);
      expect(mentionInsertSpy).toHaveBeenCalled();
    });

    it('resolves @alice @bob → 2 mentions, single mention INSERT batch', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx, mentionInsertSpy } = makeTx({
        insertedComment: { ...baseComment, body: '@alice @bob look' },
        resolvedUsers: [
          { id: 'u-alice', email: 'alice@example.com' },
          { id: 'u-bob', email: 'bob@example.com' },
        ],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: '@alice @bob look',
      });

      expect(result.mentions).toHaveLength(2);
      expect(mentionInsertSpy).toHaveBeenCalledTimes(1);
    });

    it('dedups @alice @alice to 1 handle before resolution', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx } = makeTx({
        insertedComment: { ...baseComment, body: '@alice @alice' },
        resolvedUsers: [{ id: 'u-alice', email: 'alice@example.com' }],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: '@alice @alice',
      });

      expect(result.mentions).toHaveLength(1);
    });

    it('@nonexistent → 0 mentions, comment still created', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx, mentionInsertSpy } = makeTx({
        insertedComment: { ...baseComment, body: '@nonexistent hi' },
        resolvedUsers: [],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: '@nonexistent hi',
      });

      expect(result.id).toBe('c1');
      expect(result.mentions).toEqual([]);
      // The mention insert should NOT fire when there are no resolved users.
      expect(mentionInsertSpy).not.toHaveBeenCalled();
    });

    it('resolves 3+ users sharing the same email local-part', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx } = makeTx({
        insertedComment: { ...baseComment, body: '@alice ping' },
        // Same local-part `alice`, different domains → all 3 resolved.
        resolvedUsers: [
          { id: 'u-alice-a', email: 'alice@foo.io' },
          { id: 'u-alice-b', email: 'alice@bar.io' },
          { id: 'u-alice-c', email: 'alice@baz.io' },
        ],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: '@alice ping',
      });
      expect(result.mentions).toHaveLength(3);
      expect(result.mentions.map((m) => m.email).sort()).toEqual([
        'alice@bar.io',
        'alice@baz.io',
        'alice@foo.io',
      ]);
    });

    it('extracts @alice from a code span — server regex is not code-fence aware (MVP)', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx, mentionInsertSpy } = makeTx({
        insertedComment: { ...baseComment, body: 'see `@alice` here' },
        resolvedUsers: [{ id: 'u-alice', email: 'alice@x.io' }],
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: 'see `@alice` here',
      });
      expect(result.mentions).toHaveLength(1);
      expect(mentionInsertSpy).toHaveBeenCalled();
    });

    it('email-like string `foo@bar.com` is NOT extracted as a mention', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      const { tx, mentionInsertSpy } = makeTx({
        insertedComment: { ...baseComment, body: 'email me at foo@bar.com' },
      });
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.create('MJ', 'issue-1', userId, {
        body: 'email me at foo@bar.com',
      });

      expect(result.mentions).toEqual([]);
      expect(mentionInsertSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on empty body', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on whitespace-only body', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: '   \n\t  ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on body > 10000 chars', async () => {
      const db = makeDb([]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'x'.repeat(10001) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const db = makeDb([[ownerProject], []]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner of project', async () => {
      const db = makeDb([[otherProject]]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.create('MJ', 'issue-1', userId, { body: 'Hi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('stores the trimmed body', async () => {
      const db = makeDb([[ownerProject], [issueRow]]);
      let captured: any = null;
      const { tx } = makeTx({
        insertedComment: { ...baseComment, body: 'hello' },
      });
      // Override the first insert to capture values
      tx.insert = jest
        .fn()
        .mockImplementationOnce(() => ({
          values: jest.fn().mockImplementation((vals: any) => {
            captured = vals;
            return {
              returning: jest
                .fn()
                .mockResolvedValue([{ ...baseComment, body: vals.body }]),
            };
          }),
        }));
      db.transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      await service.create('MJ', 'issue-1', userId, { body: '  hello  ' });
      expect(captured.body).toBe('hello');
    });
  });

  // ===== listByIssue =====

  describe('listByIssue', () => {
    it('returns comments with empty mentions arrays when none exist', async () => {
      const commentRows = [
        {
          id: 'c1',
          issueId: 'issue-1',
          authorId: userId,
          body: 'first',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      // Queue: project, issue, comments, mentions (empty)
      const db = makeDb([[ownerProject], [issueRow], commentRows, []]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.listByIssue('MJ', 'issue-1', userId);
      expect(result).toHaveLength(1);
      expect(result[0].mentions).toEqual([]);
    });

    it('returns comments populated with mentions from the join', async () => {
      const commentRows = [
        {
          id: 'c1',
          issueId: 'issue-1',
          authorId: userId,
          body: 'Hey @alice',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mentionRows = [
        { commentId: 'c1', userId: 'u-alice', email: 'alice@example.com' },
      ];
      // Queue: project, issue, comments, mentions
      const db = makeDb([[ownerProject], [issueRow], commentRows, mentionRows]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.listByIssue('MJ', 'issue-1', userId);
      expect(result[0].mentions).toEqual([
        { userId: 'u-alice', email: 'alice@example.com' },
      ]);
    });

    it('returns empty array (skips mention query) when no comments', async () => {
      const db = makeDb([[ownerProject], [issueRow], []]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);

      const result = await service.listByIssue('MJ', 'issue-1', userId);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const db = makeDb([[ownerProject], []]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.listByIssue('MJ', 'issue-1', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner', async () => {
      const db = makeDb([[otherProject]]);
      service = new CommentsService(db, mockEventService, mockNotificationsService);
      await expect(
        service.listByIssue('MJ', 'issue-1', userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
