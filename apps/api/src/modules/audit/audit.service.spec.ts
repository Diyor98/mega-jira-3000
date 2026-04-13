import { AuditLogService, redact } from './audit.service';

describe('AuditLogService', () => {
  const valuesSpy = jest.fn().mockResolvedValue(undefined);
  const db: any = {
    insert: jest.fn().mockReturnValue({ values: valuesSpy }),
  };
  const service = new AuditLogService(db);

  beforeEach(() => {
    valuesSpy.mockClear();
    db.insert.mockClear();
    db.insert.mockReturnValue({ values: valuesSpy });
  });

  it('inserts with expected shape', async () => {
    await service.record({
      projectId: 'proj-1',
      actorId: 'user-1',
      entityType: 'issue',
      entityId: 'issue-1',
      action: 'created',
      after: { title: 'foo' },
    });
    expect(db.insert).toHaveBeenCalled();
    const row = valuesSpy.mock.calls[0][0];
    expect(row).toMatchObject({
      projectId: 'proj-1',
      actorId: 'user-1',
      entityType: 'issue',
      entityId: 'issue-1',
      action: 'created',
      beforeValue: null,
      afterValue: { title: 'foo' },
      metadata: null,
    });
  });

  it('allows null project + actor (post-cascade case)', async () => {
    await service.record({
      projectId: null,
      actorId: null,
      entityType: 'attachment',
      entityId: 'att-1',
      action: 'deleted',
      before: { fileName: 'x.png' },
    });
    const row = valuesSpy.mock.calls[0][0];
    expect(row.projectId).toBeNull();
    expect(row.actorId).toBeNull();
    expect(row.beforeValue).toEqual({ fileName: 'x.png' });
  });

  it('swallows insert errors without throwing (fail-soft)', async () => {
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    db.insert.mockReturnValueOnce({
      values: jest.fn().mockRejectedValue(new Error('boom')),
    });
    await expect(
      service.record({
        projectId: 'p',
        actorId: 'a',
        entityType: 'issue',
        entityId: 'i',
        action: 'created',
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AUDIT] auditLog.insertFailed'),
    );
    warnSpy.mockRestore();
  });

  it('redact() strips sensitive keys', () => {
    const out = redact({
      title: 'ok',
      passwordHash: 'h',
      refreshToken: 't',
      secretKey: 's',
    });
    expect(out).toEqual({
      title: 'ok',
      passwordHash: '[REDACTED]',
      refreshToken: '[REDACTED]',
      secretKey: '[REDACTED]',
    });
  });

  it('redact() applied inside record() on before/after', async () => {
    await service.record({
      projectId: null,
      actorId: null,
      entityType: 'issue',
      entityId: 'i',
      action: 'updated',
      before: { title: 'a', passwordHash: 'h' },
      after: { title: 'b', refreshTokenHash: 'r' },
    });
    const row = valuesSpy.mock.calls[0][0];
    expect(row.beforeValue).toEqual({ title: 'a', passwordHash: '[REDACTED]' });
    expect(row.afterValue).toEqual({ title: 'b', refreshTokenHash: '[REDACTED]' });
  });
});
