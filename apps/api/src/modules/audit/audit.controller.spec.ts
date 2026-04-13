import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AuditController } from './audit.controller';

function makeReq(userId: string) {
  return { user: { userId } } as unknown as any;
}

describe('AuditController', () => {
  function buildDb(
    project: unknown | null,
    rows: Array<Record<string, unknown>> = [],
  ) {
    let call = 0;
    const db: any = {
      select: jest.fn().mockImplementation(() => {
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
        // audit rows query: from → leftJoin → where → orderBy → limit
        return {
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue(rows),
                }),
              }),
            }),
          }),
        };
      }),
    };
    return db;
  }

  it('404 on unknown project', async () => {
    const ctrl = new AuditController(buildDb(null));
    await expect(ctrl.list('NOPE', undefined, undefined, makeReq('u1'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403 when non-owner', async () => {
    const ctrl = new AuditController(
      buildDb({ id: 'p1', ownerId: 'other' }),
    );
    await expect(ctrl.list('MEGA', undefined, undefined, makeReq('u1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns rows + null cursor when under limit', async () => {
    const rows = [
      {
        id: 'a1',
        entityType: 'issue',
        entityId: 'i1',
        action: 'created',
        actorId: 'u1',
        actorEmail: 'a@b.c',
        beforeValue: null,
        afterValue: {},
        metadata: null,
        createdAt: new Date('2026-04-13T00:00:00Z'),
      },
    ];
    const ctrl = new AuditController(
      buildDb({ id: 'p1', ownerId: 'u1' }, rows),
    );
    const result = await ctrl.list('MEGA', '50', undefined, makeReq('u1'));
    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('returns nextCursor when over limit', async () => {
    const rows = new Array(3).fill(null).map((_, i) => ({
      id: `id-${i}`,
      entityType: 'issue',
      entityId: 'i',
      action: 'created',
      actorId: 'u',
      actorEmail: 'e',
      beforeValue: null,
      afterValue: null,
      metadata: null,
      createdAt: new Date(`2026-04-${13 - i}T00:00:00Z`),
    }));
    const ctrl = new AuditController(
      buildDb({ id: 'p1', ownerId: 'u1' }, rows),
    );
    const result = await ctrl.list('MEGA', '2', undefined, makeReq('u1'));
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
  });

  it('400 on malformed cursor', async () => {
    const ctrl = new AuditController(
      buildDb({ id: 'p1', ownerId: 'u1' }),
    );
    await expect(
      ctrl.list('MEGA', undefined, 'not-base64', makeReq('u1')),
    ).rejects.toThrow(BadRequestException);
  });
});
