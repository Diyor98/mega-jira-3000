import { UsersService } from './users.service';

describe('UsersService', () => {
  function makeDb(rows: Array<{ id: string; email: string }>) {
    const limitFn = jest.fn().mockResolvedValue(rows);
    const orderByFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ orderBy: orderByFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db: any = { select: selectFn };
    return { db, limitFn };
  }

  it('returns rows with {id, email} shape', async () => {
    const rows = [
      { id: 'u1', email: 'a@x.io' },
      { id: 'u2', email: 'b@x.io' },
    ];
    const { db } = makeDb(rows);
    const service = new UsersService(db);

    const result = await service.list();
    expect(result).toEqual(rows);
  });

  it('caps the query with limit(100)', async () => {
    const { db, limitFn } = makeDb([]);
    const service = new UsersService(db);
    await service.list();
    expect(limitFn).toHaveBeenCalledWith(100);
  });
});
