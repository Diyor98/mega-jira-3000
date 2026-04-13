jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
  },
  constants: { F_OK: 0, R_OK: 4 },
}));

import { DataLifecycleService } from './data-lifecycle.service';
import { promises as fs } from 'fs';

describe('DataLifecycleService', () => {
  function buildService(opts: {
    expiredAttachments: Array<{ id: string; issueId: string; storedName: string; sizeBytes: number }>;
    issueProjectRows?: Array<{ id: string; projectId: string }>;
    deletedComments?: number;
    deletedIssues?: number;
  }) {
    const issueRows =
      opts.issueProjectRows ??
      Array.from(
        new Set(opts.expiredAttachments.map((a) => a.issueId)),
      ).map((id) => ({ id, projectId: 'proj-1' }));

    let selectCall = 0;
    const db: any = {
      select: jest.fn().mockImplementation(() => {
        selectCall++;
        const payload = selectCall === 1 ? opts.expiredAttachments : issueRows;
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(Promise.resolve(payload)),
          }),
        };
      }),
      delete: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockImplementation(() => ({
          returning: jest.fn().mockResolvedValue([]),
          // for attachment delete (no .returning) return Promise directly
          then: undefined,
        })),
      })),
    };
    // attachment delete path awaits the chain — support both .returning and bare
    db.delete = jest.fn().mockImplementation(() => {
      const chain: any = {
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      };
      // Allow awaiting .where() directly (attachment path does `.delete(x).where(y)`)
      chain.where = jest.fn().mockImplementation(() => {
        const awaitable: any = Promise.resolve([]);
        awaitable.returning = jest.fn().mockResolvedValue([]);
        return awaitable;
      });
      return chain;
    });
    return { db, service: new DataLifecycleService(db) };
  }

  beforeEach(() => {
    (fs.unlink as jest.Mock).mockClear();
    (fs.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  it('unlinks expired attachment files and counts bytes', async () => {
    const { service } = buildService({
      expiredAttachments: [
        { id: 'a1', issueId: 'i1', storedName: 'abc.png', sizeBytes: 100 },
        { id: 'a2', issueId: 'i1', storedName: 'def.pdf', sizeBytes: 200 },
      ],
    });
    const report = await service.purgeExpired();
    expect(report.attachments).toBe(2);
    expect(report.attachmentBytes).toBe(300);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it('swallows ENOENT on unlink (file already gone)', async () => {
    (fs.unlink as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    const { service } = buildService({
      expiredAttachments: [
        { id: 'a1', issueId: 'i1', storedName: 'abc.png', sizeBytes: 100 },
      ],
    });
    const report = await service.purgeExpired();
    expect(report.errors).toEqual([]);
  });

  it('records non-ENOENT unlink errors but continues', async () => {
    (fs.unlink as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('perm'), { code: 'EACCES' }),
    );
    const { service } = buildService({
      expiredAttachments: [
        { id: 'a1', issueId: 'i1', storedName: 'abc.png', sizeBytes: 100 },
      ],
    });
    const report = await service.purgeExpired();
    expect(report.errors.some((e) => e.includes('perm'))).toBe(true);
  });

  it('re-entrance guard prevents overlapping runs', async () => {
    const { service } = buildService({ expiredAttachments: [] });
    (service as any).running = true;
    const report = await service.purgeExpired();
    expect(report.errors).toContain('already running');
  });
});
